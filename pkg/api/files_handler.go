package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// FileNode is one node in the repository file tree.
type FileNode struct {
	Name      string     `json:"name"`
	Path      string     `json:"path"`
	IsDir     bool       `json:"is_dir"`
	Children  []FileNode `json:"children,omitempty"`
	GitStatus *string    `json:"git_status,omitempty"`
}

// FileTreeResponse is the JSON body for GET /api/files/tree.
type FileTreeResponse struct {
	Repo string   `json:"repo"`
	Root FileNode `json:"root"`
}

// FileContentResponse is the JSON body for GET /api/files/read.
type FileContentResponse struct {
	Repo     string `json:"repo"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Language string `json:"language"`
	Size     int64  `json:"size"`
}

// GitFileStatus represents one file entry from git status.
type GitFileStatus struct {
	Path   string `json:"path"`
	Status string `json:"status"` // "M", "A", "U", "D"
}

// GitStatusResponse is the JSON body for GET /api/files/status.
type GitStatusResponse struct {
	Repo  string          `json:"repo"`
	Files []GitFileStatus `json:"files"`
}

// skipDirs is the set of directory names that should not be traversed when
// building the file tree.
var skipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"target":       true,
	".next":        true,
}

// languageMap maps file extensions to language identifiers for syntax highlighting.
var languageMap = map[string]string{
	".go":    "go",
	".ts":    "typescript",
	".tsx":   "tsx",
	".js":    "javascript",
	".jsx":   "jsx",
	".json":  "json",
	".yaml":  "yaml",
	".yml":   "yaml",
	".md":    "markdown",
	".sh":    "bash",
	".bash":  "bash",
	".zsh":   "bash",
	".py":    "python",
	".rs":    "rust",
	".toml":  "toml",
	".html":  "html",
	".css":   "css",
	".scss":  "scss",
	".sql":   "sql",
	".proto": "protobuf",
	".xml":   "xml",
	".c":     "c",
	".cpp":   "cpp",
	".h":     "c",
	".hpp":   "cpp",
	".java":  "java",
	".kt":    "kotlin",
	".rb":    "ruby",
	".swift": "swift",
	".tf":    "hcl",
	".hcl":   "hcl",
	".lua":   "lua",
	".r":     "r",
	".Makefile": "makefile",
	".makefile": "makefile",
	".dockerfile": "dockerfile",
	".env":   "bash",
	".txt":   "text",
}

// resolveRepoPath looks up the named repo from saw.config.json in the server's
// RepoPath directory and returns the absolute filesystem path for that repo.
// Returns "", false if the repo name is not found.
func (s *Server) resolveRepoPath(repoName string) (string, bool) {
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		// Fall back to the server's own RepoPath when no config file exists.
		if filepath.Base(s.cfg.RepoPath) == repoName {
			return s.cfg.RepoPath, true
		}
		return "", false
	}

	var cfg SAWConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return "", false
	}

	// Backward-compat: migrate legacy repo.path into repos list on-the-fly.
	if len(cfg.Repos) == 0 && cfg.Repo.Path != "" {
		cfg.Repos = []RepoEntry{{Name: "repo", Path: cfg.Repo.Path}}
	}

	for _, r := range cfg.Repos {
		if r.Name == repoName {
			return r.Path, true
		}
	}
	return "", false
}

// safeRepoPath validates that the combined repoRoot+relPath does not escape the
// repository root after filepath.Clean. Returns the absolute path on success or
// an error string to return to the client.
func safeRepoPath(repoRoot, relPath string) (string, bool) {
	// Always start from the clean repo root.
	clean := filepath.Clean(filepath.Join(repoRoot, relPath))
	// The resolved path must be either equal to or inside repoRoot.
	if clean != repoRoot && !strings.HasPrefix(clean, repoRoot+string(os.PathSeparator)) {
		return "", false
	}
	return clean, true
}

// handleFilesTree serves GET /api/files/tree?repo=<name>&path=<relpath>
// Returns a recursive directory tree rooted at the requested path (default: repo root).
func (s *Server) handleFilesTree(w http.ResponseWriter, r *http.Request) {
	repoName := r.URL.Query().Get("repo")
	if repoName == "" {
		http.Error(w, "missing repo query param", http.StatusBadRequest)
		return
	}

	repoRoot, ok := s.resolveRepoPath(repoName)
	if !ok {
		http.Error(w, "repo not found", http.StatusBadRequest)
		return
	}

	relPath := r.URL.Query().Get("path")
	// Default to the repo root itself.
	if relPath == "" {
		relPath = "."
	}

	absPath, ok := safeRepoPath(repoRoot, relPath)
	if !ok {
		http.Error(w, "path escapes repository root", http.StatusBadRequest)
		return
	}

	// Collect git status so we can annotate nodes.
	statusMap := collectGitStatus(repoRoot)

	root, err := buildFileTree(repoRoot, absPath, statusMap)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "path not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := FileTreeResponse{
		Repo: repoName,
		Root: root,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// buildFileTree recursively constructs a FileNode tree starting at absPath.
// repoRoot is used to compute relative paths for each node.
// statusMap maps repo-relative paths to git status characters.
func buildFileTree(repoRoot, absPath string, statusMap map[string]string) (FileNode, error) {
	info, err := os.Stat(absPath)
	if err != nil {
		return FileNode{}, err
	}

	// Compute the repo-relative path for this node.
	relPath, err := filepath.Rel(repoRoot, absPath)
	if err != nil {
		relPath = filepath.Base(absPath)
	}
	// Use forward slashes in JSON paths regardless of OS.
	relPath = filepath.ToSlash(relPath)

	node := FileNode{
		Name:  info.Name(),
		Path:  relPath,
		IsDir: info.IsDir(),
	}

	// Annotate with git status if available.
	if s, found := statusMap[relPath]; found {
		node.GitStatus = &s
	}

	if !info.IsDir() {
		return node, nil
	}

	// Directory: recurse into children, skipping blacklisted dirs.
	entries, err := os.ReadDir(absPath)
	if err != nil {
		return node, nil // return node without children on permission error
	}

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() && skipDirs[name] {
			continue
		}
		childAbs := filepath.Join(absPath, name)
		child, err := buildFileTree(repoRoot, childAbs, statusMap)
		if err != nil {
			continue // skip entries we can't read
		}
		node.Children = append(node.Children, child)
	}

	return node, nil
}

// handleFilesRead serves GET /api/files/read?repo=<name>&path=<relpath>
// Returns file content with language detection; rejects files >1 MB or binary files.
func (s *Server) handleFilesRead(w http.ResponseWriter, r *http.Request) {
	repoName := r.URL.Query().Get("repo")
	if repoName == "" {
		http.Error(w, "missing repo query param", http.StatusBadRequest)
		return
	}

	repoRoot, ok := s.resolveRepoPath(repoName)
	if !ok {
		http.Error(w, "repo not found", http.StatusBadRequest)
		return
	}

	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "missing path query param", http.StatusBadRequest)
		return
	}

	absPath, ok := safeRepoPath(repoRoot, relPath)
	if !ok {
		http.Error(w, "path escapes repository root", http.StatusBadRequest)
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if info.IsDir() {
		http.Error(w, "path is a directory", http.StatusBadRequest)
		return
	}

	const maxSize = 1048576 // 1 MB
	if info.Size() > maxSize {
		http.Error(w, "file too large (max 1 MB)", http.StatusRequestEntityTooLarge)
		return
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		http.Error(w, "failed to read file", http.StatusInternalServerError)
		return
	}

	// Binary detection: check the first 512 bytes for null bytes.
	probe := data
	if len(probe) > 512 {
		probe = probe[:512]
	}
	if bytes.IndexByte(probe, 0) != -1 {
		http.Error(w, "binary file not supported", http.StatusUnsupportedMediaType)
		return
	}

	// Compute repo-relative path (forward slashes for JSON).
	cleanRel, _ := filepath.Rel(repoRoot, absPath)
	cleanRel = filepath.ToSlash(cleanRel)

	lang := detectLanguage(absPath)

	resp := FileContentResponse{
		Repo:     repoName,
		Path:     cleanRel,
		Content:  string(data),
		Language: lang,
		Size:     info.Size(),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// handleFilesDiff serves GET /api/files/diff?repo=<name>&path=<relpath>
// Returns the git diff (unstaged + staged) for the given file.
func (s *Server) handleFilesDiff(w http.ResponseWriter, r *http.Request) {
	repoName := r.URL.Query().Get("repo")
	if repoName == "" {
		http.Error(w, "missing repo query param", http.StatusBadRequest)
		return
	}

	repoRoot, ok := s.resolveRepoPath(repoName)
	if !ok {
		http.Error(w, "repo not found", http.StatusBadRequest)
		return
	}

	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "missing path query param", http.StatusBadRequest)
		return
	}

	absPath, ok := safeRepoPath(repoRoot, relPath)
	if !ok {
		http.Error(w, "path escapes repository root", http.StatusBadRequest)
		return
	}

	// Compute repo-relative path for git (use forward slashes).
	gitRelPath, err := filepath.Rel(repoRoot, absPath)
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	gitRelPath = filepath.ToSlash(gitRelPath)

	// Combine unstaged diff (git diff HEAD) and staged diff (git diff --cached).
	var diffBuf strings.Builder

	unstagedCmd := exec.Command("git", "diff", "HEAD", "--", gitRelPath)
	unstagedCmd.Dir = repoRoot
	if out, err := unstagedCmd.Output(); err == nil {
		diffBuf.Write(out)
	}

	stagedCmd := exec.Command("git", "diff", "--cached", "--", gitRelPath)
	stagedCmd.Dir = repoRoot
	if out, err := stagedCmd.Output(); err == nil {
		diffBuf.Write(out)
	}

	cleanRel, _ := filepath.Rel(repoRoot, absPath)
	cleanRel = filepath.ToSlash(cleanRel)

	resp := map[string]string{
		"repo": repoName,
		"path": cleanRel,
		"diff": diffBuf.String(),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// handleFilesStatus serves GET /api/files/status?repo=<name>
// Returns git status for all files in the repository.
func (s *Server) handleFilesStatus(w http.ResponseWriter, r *http.Request) {
	repoName := r.URL.Query().Get("repo")
	if repoName == "" {
		http.Error(w, "missing repo query param", http.StatusBadRequest)
		return
	}

	repoRoot, ok := s.resolveRepoPath(repoName)
	if !ok {
		http.Error(w, "repo not found", http.StatusBadRequest)
		return
	}

	files := parseGitStatus(repoRoot)

	resp := GitStatusResponse{
		Repo:  repoName,
		Files: files,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// collectGitStatus runs git status --porcelain and returns a map from
// repo-relative path (forward-slashed) to a single-character status code.
func collectGitStatus(repoRoot string) map[string]string {
	result := make(map[string]string)
	files := parseGitStatus(repoRoot)
	for _, f := range files {
		result[f.Path] = f.Status
	}
	return result
}

// parseGitStatus runs git status --porcelain and returns a slice of GitFileStatus.
// Status codes: M=modified, A=added/staged-new, U=untracked, D=deleted.
func parseGitStatus(repoRoot string) []GitFileStatus {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return []GitFileStatus{}
	}

	var files []GitFileStatus
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 4 {
			continue
		}
		xy := line[:2]   // two-character XY status field
		path := strings.TrimSpace(line[3:]) // remaining path (may contain " -> " for renames)

		// For renames, git outputs "old -> new"; we want the new path.
		if idx := strings.Index(path, " -> "); idx != -1 {
			path = path[idx+4:]
		}
		path = strings.Trim(path, "\"") // git may quote paths with special chars

		// Map git XY codes to our simplified status.
		status := mapGitStatus(xy)
		if status == "" {
			continue
		}

		files = append(files, GitFileStatus{
			Path:   filepath.ToSlash(path),
			Status: status,
		})
	}

	if files == nil {
		return []GitFileStatus{}
	}
	return files
}

// mapGitStatus converts a two-character git porcelain XY code to a simplified
// status string: "M" (modified), "A" (added), "U" (untracked), "D" (deleted).
// Returns "" for unrecognised / ignored entries.
func mapGitStatus(xy string) string {
	if len(xy) < 2 {
		return ""
	}
	x, y := xy[0], xy[1]

	switch {
	case x == '?' && y == '?':
		return "U" // untracked
	case x == 'D' || y == 'D':
		return "D" // deleted (staged or unstaged)
	case x == 'A' || x == 'C':
		return "A" // added / copied (staged)
	case x == 'M' || y == 'M':
		return "M" // modified (staged or unstaged)
	case x == 'R':
		return "M" // renamed (treat as modified for simplicity)
	default:
		return ""
	}
}

// detectLanguage returns a language identifier for syntax highlighting based on
// the file extension (or special filenames like Makefile, Dockerfile).
func detectLanguage(filename string) string {
	base := strings.ToLower(filepath.Base(filename))

	// Special filenames without extensions.
	switch base {
	case "makefile", "gnumakefile":
		return "makefile"
	case "dockerfile":
		return "dockerfile"
	case ".env", ".envrc":
		return "bash"
	case "jenkinsfile", "vagrantfile":
		return "groovy"
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if lang, ok := languageMap[ext]; ok {
		return lang
	}
	return "text"
}

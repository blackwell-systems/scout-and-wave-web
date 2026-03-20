package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// ImplListEntry is one item returned by ListImpls.
type ImplListEntry struct {
	Slug          string   `json:"slug"`
	Repo          string   `json:"repo"`
	RepoPath      string   `json:"repo_path"`
	DocStatus     string   `json:"doc_status"`
	WaveCount     int      `json:"wave_count"`
	AgentCount    int      `json:"agent_count"`
	IsMultiRepo   bool     `json:"is_multi_repo"`
	InvolvedRepos []string `json:"involved_repos"`
}

// ListImpls scans all configured repos for IMPL YAML files and returns a
// structured list. It does NOT compute IsExecuting — that requires runtime
// state (active runs) which stays in the API layer.
func ListImpls(deps Deps) ([]ImplListEntry, error) {
	repos := GetConfiguredRepos(deps)

	var result []ImplListEntry

	for _, repo := range repos {
		implDirs := []string{
			filepath.Join(repo.Path, "docs", "IMPL"),
			filepath.Join(repo.Path, "docs", "IMPL", "complete"),
		}

		for _, implDir := range implDirs {
			dirEntries, err := os.ReadDir(implDir)
			if err != nil {
				continue // skip if directory doesn't exist
			}

			for _, e := range dirEntries {
				name := e.Name()
				if !strings.HasPrefix(name, "IMPL-") || !strings.HasSuffix(name, ".yaml") {
					continue
				}

				fullPath := filepath.Join(implDir, name)

				slug := strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".yaml")
				status := "active"
				if strings.HasSuffix(implDir, "complete") {
					status = "complete"
				}
				var waveCount, agentCount int
				var isMultiRepo bool
				var involvedRepos []string

				if m, err := protocol.Load(fullPath); err == nil {
					for _, w := range m.Waves {
						waveCount++
						agentCount += len(w.Agents)
					}
					repoSet := make(map[string]struct{})
					hasEmptyRepo := false
					for _, fo := range m.FileOwnership {
						if fo.Repo != "" && fo.Repo != "system" {
							repoSet[fo.Repo] = struct{}{}
						} else if fo.Repo == "" {
							hasEmptyRepo = true
						}
					}
					if hasEmptyRepo && len(repoSet) > 0 {
						repoSet[repo.Name] = struct{}{}
					}
					isMultiRepo = len(repoSet) >= 2
					if isMultiRepo {
						for repoName := range repoSet {
							involvedRepos = append(involvedRepos, repoName)
						}
						sort.Strings(involvedRepos)
					}
				}

				repoName := repo.Name
				if repoName == "" {
					repoName = filepath.Base(repo.Path)
				}

				result = append(result, ImplListEntry{
					Slug:          slug,
					Repo:          repoName,
					RepoPath:      repo.Path,
					DocStatus:     status,
					WaveCount:     waveCount,
					AgentCount:    agentCount,
					IsMultiRepo:   isMultiRepo,
					InvolvedRepos: involvedRepos,
				})
			}
		}
	}

	if result == nil {
		result = []ImplListEntry{}
	}
	return result, nil
}

// GetImpl loads and parses a single IMPL manifest by slug.
// Returns the manifest, matched repo name, and repo entry.
func GetImpl(deps Deps, slug string) (*protocol.IMPLManifest, string, RepoEntry, error) {
	implPath, repo, err := FindImplPath(deps, slug)
	if err != nil {
		return nil, "", RepoEntry{}, err
	}

	manifest, loadErr := protocol.Load(implPath)
	if loadErr != nil {
		if os.IsNotExist(loadErr) {
			return nil, "", RepoEntry{}, fmt.Errorf("IMPL doc not found for slug: %s", slug)
		}
		return nil, "", RepoEntry{}, fmt.Errorf("failed to load IMPL manifest: %w", loadErr)
	}

	repoName := repo.Name
	if repoName == "" {
		repoName = filepath.Base(repo.Path)
	}
	return manifest, repoName, repo, nil
}

// ApproveImpl publishes a plan_approved event via Publisher.
func ApproveImpl(deps Deps, slug string) error {
	if deps.Publisher == nil {
		return fmt.Errorf("no event publisher configured")
	}
	deps.Publisher.Publish(slug, Event{
		Channel: slug,
		Name:    "plan_approved",
		Data:    map[string]string{"slug": slug},
	})
	return nil
}

// RejectImpl publishes a plan_rejected event via Publisher.
func RejectImpl(deps Deps, slug string) error {
	if deps.Publisher == nil {
		return fmt.Errorf("no event publisher configured")
	}
	deps.Publisher.Publish(slug, Event{
		Channel: slug,
		Name:    "plan_rejected",
		Data:    map[string]string{"slug": slug},
	})
	return nil
}

// DeleteImpl removes an IMPL file from disk. Searches both active and complete
// directories under deps.IMPLDir.
func DeleteImpl(deps Deps, slug string) error {
	dirs := []string{
		deps.IMPLDir,
		filepath.Join(deps.IMPLDir, "complete"),
	}

	for _, dir := range dirs {
		yamlPath := filepath.Join(dir, "IMPL-"+slug+".yaml")
		if _, err := os.Stat(yamlPath); err == nil {
			return os.Remove(yamlPath)
		}
	}

	return fmt.Errorf("IMPL doc not found for slug: %s", slug)
}

// ArchiveImpl moves an IMPL file from the active directory to complete/.
func ArchiveImpl(deps Deps, slug string) error {
	activeDir := deps.IMPLDir
	completeDir := filepath.Join(deps.IMPLDir, "complete")

	candidate := filepath.Join(activeDir, "IMPL-"+slug+".yaml")
	if _, err := os.Stat(candidate); err != nil {
		return fmt.Errorf("IMPL not found in active directory: %s", slug)
	}

	if err := os.MkdirAll(completeDir, 0755); err != nil {
		return fmt.Errorf("failed to create complete directory: %w", err)
	}

	destPath := filepath.Join(completeDir, filepath.Base(candidate))
	if err := os.Rename(candidate, destPath); err != nil {
		return fmt.Errorf("failed to archive IMPL: %w", err)
	}

	return nil
}

// FindImplPath searches all configured repos for an IMPL doc by slug.
// Returns the absolute file path and matched repo entry, or error if not found.
func FindImplPath(deps Deps, slug string) (string, RepoEntry, error) {
	repos := GetConfiguredRepos(deps)

	for _, repo := range repos {
		for _, sub := range []string{"docs/IMPL", "docs/IMPL/complete"} {
			candidate := filepath.Join(repo.Path, sub, "IMPL-"+slug+".yaml")
			if _, err := os.Stat(candidate); err == nil {
				return candidate, repo, nil
			}
		}
	}
	return "", RepoEntry{}, fmt.Errorf("IMPL doc not found for slug: %s", slug)
}

// ResolveIMPLPath searches all configured repos for the IMPL doc with the
// given slug. Returns (implPath, repoPath, nil) on success.
func ResolveIMPLPath(deps Deps, slug string) (implPath, repoPath string, err error) {
	path, repo, findErr := FindImplPath(deps, slug)
	if findErr != nil {
		return "", "", findErr
	}
	return path, repo.Path, nil
}

# saw Configuration Reference

The `saw` binary can be configured via `saw.config.json` in your project root. Configuration is optional — all settings have sensible defaults.

**Location:** `<repo-root>/saw.config.json`

## Configuration File Structure

```json
{
  "repos": [
    {
      "path": "/absolute/path/to/project",
      "name": "MyProject",
      "active": true
    }
  ],
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-4"
  },
  "quality": {
    "require_tests": true,
    "require_lint": false,
    "block_on_failure": true
  },
  "appearance": {
    "theme": "system"
  }
}
```

---

## Top-Level Fields

### repos

Array of repository entries for multi-repo support (future feature).

**Type:** `array` of `RepoEntry` objects

**Default:** `[]` (auto-detected from `--repo` flag or cwd)

**Fields:**
- `path` (string, required) — Absolute path to repository root
- `name` (string, optional) — Display name for repository
- `active` (boolean, optional) — Whether this repo is currently active

**Example:**
```json
{
  "repos": [
    {
      "path": "/Users/you/code/myapp",
      "name": "MyApp",
      "active": true
    },
    {
      "path": "/Users/you/code/backend",
      "name": "Backend API",
      "active": false
    }
  ]
}
```

**Note:** Currently, `saw serve --repo` flag takes precedence. The `repos` array is for future multi-repo workspace support.

---

### agent

Model selection for Scout, Wave, and Chat agents.

**Type:** `object`

**Default:**
```json
{
  "scout_model": "claude-sonnet-4",
  "wave_model": "claude-sonnet-4",
  "chat_model": "claude-sonnet-4"
}
```

#### agent.scout_model

Model used for `saw scout` (IMPL doc generation).

**Type:** `string`

**Options:**
- `claude-sonnet-4` — Claude 4 Sonnet (2025-02-01) — **default**, best for complex analysis
- `claude-sonnet-3-5` — Claude 3.5 Sonnet (2024-10-22) — faster, good for simpler tasks
- `claude-opus-4` — Claude 4 Opus (2025-02-01) — highest capability, slower

**Example:**
```json
{
  "agent": {
    "scout_model": "claude-opus-4"
  }
}
```

**Recommendation:** Use `claude-sonnet-4` for production. It balances speed and quality.

#### agent.wave_model

Model used for wave agents (implementation tasks).

**Type:** `string`

**Options:** Same as `scout_model`

**Example:**
```json
{
  "agent": {
    "wave_model": "claude-sonnet-4"
  }
}
```

**Recommendation:** Use `claude-sonnet-4`. Wave agents need strong code generation and tool use.

#### agent.chat_model

Model used for `POST /api/impl/{slug}/chat` (explanatory chat).

**Type:** `string`

**Options:** Same as `scout_model`

**Example:**
```json
{
  "agent": {
    "chat_model": "claude-sonnet-3-5"
  }
}
```

**Recommendation:** `claude-sonnet-3-5` is sufficient for chat. Faster responses, lower cost.

---

#### Provider Configuration

Model names can include provider prefixes to route to different backends:

**Format:** `<provider>:<model-id>`

**Supported Providers:**

| Provider | Prefix | Credentials | Example Model |
|----------|--------|-------------|---------------|
| **Anthropic API** | *(none)* | `ANTHROPIC_API_KEY` | `claude-sonnet-4` |
| **AWS Bedrock** | `bedrock:` | AWS credentials | `bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| **OpenAI** | `openai:` | `OPENAI_API_KEY` | `openai:gpt-4` |
| **Ollama** | `ollama:` | *(none)* | `ollama:llama3` |
| **LM Studio** | `lmstudio:` | *(none)* | `lmstudio:local-model` |

**Example Configuration:**
```json
{
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "chat_model": "ollama:llama3"
  }
}
```

**Notes:**
- **Anthropic API** (default): No prefix needed. Requires `ANTHROPIC_API_KEY` environment variable.
- **AWS Bedrock**: Requires AWS credentials (see [AWS Credentials](#aws-credentials-for-bedrock) section). Model IDs must be full inference profile IDs.
- **OpenAI**: Requires `OPENAI_API_KEY` environment variable. Supports any OpenAI model.
- **Ollama**: Connects to `http://localhost:11434/v1`. No credentials needed. Requires Ollama running locally.
- **LM Studio**: Connects to `http://localhost:1234/v1`. No credentials needed. Requires LM Studio running locally with API server enabled.

**Custom Base URL:**
For OpenAI-compatible APIs (not Ollama/LM Studio), set `OPENAI_BASE_URL` environment variable:
```bash
export OPENAI_BASE_URL=https://api.groq.com/openai/v1
export OPENAI_API_KEY=gsk-...
```

Then use `openai:` prefix with the model name:
```json
{
  "agent": {
    "scout_model": "openai:llama-3.1-70b"
  }
}
```

---

### quality

Quality gate and testing configuration.

**Type:** `object`

**Default:**
```json
{
  "require_tests": false,
  "require_lint": false,
  "block_on_failure": false
}
```

#### quality.require_tests

Whether to require test execution after each wave merge.

**Type:** `boolean`

**Default:** `false`

**Behavior:**
- `true` — Run test command from IMPL manifest's `quality_gates.test_command` after merge
- `false` — Skip test execution

**Example:**
```json
{
  "quality": {
    "require_tests": true
  }
}
```

**Note:** The test command is defined in the IMPL manifest, not in `saw.config.json`:
```yaml
quality_gates:
  test_command: "go test ./..."
  lint_command: "golangci-lint run"
```

#### quality.require_lint

Whether to require linting after each wave merge.

**Type:** `boolean`

**Default:** `false`

**Behavior:**
- `true` — Run lint command from IMPL manifest's `quality_gates.lint_command` after merge
- `false` — Skip linting

**Example:**
```json
{
  "quality": {
    "require_lint": true
  }
}
```

#### quality.block_on_failure

Whether to block wave progression if quality gates fail.

**Type:** `boolean`

**Default:** `false`

**Behavior:**
- `true` — Transition to `Blocked` state if tests/lint fail; require manual intervention
- `false` — Log failure but continue to next wave

**Example:**
```json
{
  "quality": {
    "require_tests": true,
    "block_on_failure": true
  }
}
```

**Recommendation:** Set `block_on_failure: true` in CI/CD pipelines. Set `false` for rapid prototyping.

---

### appearance

Web UI appearance settings.

**Type:** `object`

**Default:**
```json
{
  "theme": "system"
}
```

#### appearance.theme

Default theme for web UI.

**Type:** `string`

**Options:**
- `system` — Follow OS theme preference (default)
- `light` — Light mode
- `dark` — Dark mode
- `gruvbox-dark` — Gruvbox Dark theme
- `darcula` — JetBrains Darcula theme
- `catppuccin-mocha` — Catppuccin Mocha theme
- `nord` — Nord theme

**Example:**
```json
{
  "appearance": {
    "theme": "dark"
  }
}
```

**Note:** Theme choice persists to browser `localStorage`. This setting is the initial default.

---

## Example Configurations

### Minimal Configuration

```json
{
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-3-5"
  }
}
```

Use defaults for everything except models. Good for most projects.

---

### CI/CD Pipeline Configuration

```json
{
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-4"
  },
  "quality": {
    "require_tests": true,
    "require_lint": true,
    "block_on_failure": true
  }
}
```

Enforce quality gates and block on failure. Ensures all waves pass tests before merging.

---

### Development Configuration

```json
{
  "agent": {
    "scout_model": "claude-sonnet-3-5",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-3-5"
  },
  "quality": {
    "require_tests": false,
    "require_lint": false,
    "block_on_failure": false
  },
  "appearance": {
    "theme": "gruvbox-dark"
  }
}
```

Fast iteration with minimal quality gates. Good for experimentation.

---

### High-Quality Configuration

```json
{
  "agent": {
    "scout_model": "claude-opus-4",
    "wave_model": "claude-opus-4",
    "chat_model": "claude-sonnet-4"
  },
  "quality": {
    "require_tests": true,
    "require_lint": true,
    "block_on_failure": true
  }
}
```

Maximum quality — use Opus for critical production features. Slower but highest accuracy.

---

## Environment Variables

Some settings can be overridden via environment variables:

### SAW_BACKEND

Override agent backend selection globally.

**Values:** `api`, `cli`, `auto`

**Example:**
```bash
export SAW_BACKEND=cli
saw scout --feature "add OAuth"
```

**Precedence:** CLI flag > environment variable > config file

---

### ANTHROPIC_API_KEY

Anthropic API key for `--backend api` or `--backend auto`.

**Required:** Only when using API backend

**Example:**
```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
saw scout --feature "add OAuth" --backend api
```

---

### AWS Credentials (for Bedrock)

AWS Bedrock uses the AWS SDK v2 default credential chain — no special configuration needed in `saw.config.json`.

**Required:** Only when using `bedrock:` model prefix

**Credential Discovery (in order):**
1. Environment variables
2. AWS credentials file (`~/.aws/credentials`)
3. IAM role (EC2/ECS instance metadata)

**Option A: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1

saw scout --feature "add OAuth"
```

**Option B: AWS Credentials File**
```bash
# ~/.aws/credentials
[default]
aws_access_key_id = your_key
aws_secret_access_key = your_secret

# ~/.aws/config
[default]
region = us-east-1
```

**Option C: IAM Role**
When running on EC2/ECS, no configuration needed — SDK discovers credentials automatically.

**Model Configuration:**
Use the `bedrock:` prefix with full inference profile ID:
```json
{
  "agent": {
    "scout_model": "bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "wave_model": "bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0"
  }
}
```

**Note:** Bedrock model IDs must be full inference profile IDs (not just `claude-sonnet-4`). The `bedrock:` prefix tells the backend router to use AWS Bedrock instead of the Anthropic API.

---

## Configuration Management

### Reading Configuration

The web UI loads `saw.config.json` from the repository root specified by `--repo` flag.

**API:** `GET /api/config`

**CLI:** No direct CLI command; use `cat saw.config.json`

---

### Updating Configuration

**Via Web UI:**
1. Navigate to Settings (gear icon)
2. Edit configuration fields
3. Click Save

**Via API:**
```bash
curl -X POST http://localhost:7432/api/config \
  -H "Content-Type: application/json" \
  -d @saw.config.json
```

**Via CLI:**
```bash
# Edit directly
vim saw.config.json
```

---

## Configuration Validation

The server validates configuration on load:

**Valid:**
```json
{
  "agent": {
    "scout_model": "claude-sonnet-4"
  }
}
```

**Invalid (unknown model):**
```json
{
  "agent": {
    "scout_model": "gpt-4"
  }
}
```

**Error:** `invalid scout_model: gpt-4`

---

## Default Behavior Without Config

If `saw.config.json` doesn't exist, `saw` uses these defaults:

```json
{
  "repos": [],
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-4"
  },
  "quality": {
    "require_tests": false,
    "require_lint": false,
    "block_on_failure": false
  },
  "appearance": {
    "theme": "system"
  }
}
```

**Repository path:** Auto-detected from `--repo` flag or current working directory.

---

## Configuration Per IMPL Doc

Quality gates and model selection can be overridden per IMPL doc in the manifest:

```yaml
# IMPL-oauth.yaml
feature: Add OAuth 2.0 authentication

quality_gates:
  test_command: "go test ./pkg/oauth/..."
  lint_command: "golangci-lint run ./pkg/oauth/"

agent_config:
  model: "claude-opus-4"  # Override wave_model for this IMPL
```

**Precedence:** IMPL manifest > `saw.config.json` > defaults

---

## Migration from Legacy Config

**Old format (v0.17.0 and earlier):**
```json
{
  "repo": {
    "path": "/path/to/project"
  }
}
```

**New format (v0.18.0+):**
```json
{
  "repos": [
    {
      "path": "/path/to/project",
      "active": true
    }
  ]
}
```

**Backward compatibility:** The server still reads `repo.path` if present, but `repos` array takes precedence.

---

## Troubleshooting

### "Config file not found"

This is **not an error**. `saw` works without `saw.config.json`. Defaults are applied.

**To create config:**
```bash
cat > saw.config.json <<EOF
{
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-4"
  }
}
EOF
```

---

### "Invalid JSON in saw.config.json"

**Error:** `failed to parse config: invalid character ',' at line 12`

**Fix:** Validate JSON syntax:
```bash
jq . saw.config.json
```

**Common mistakes:**
- Trailing commas (not allowed in JSON)
- Missing quotes around strings
- Unclosed braces/brackets

---

### "Model 'claude-sonnet-4' not available"

**Error:** `failed to initialize agent: model not found`

**Causes:**
- API key invalid or expired (for API backend)
- Claude CLI not installed (for CLI backend)
- Model ID typo

**Fix:**
```bash
# Verify API key
echo $ANTHROPIC_API_KEY

# Verify Claude CLI
claude --version

# Check model ID spelling
cat saw.config.json | jq .agent.scout_model
```

---

### Configuration not taking effect

**Symptoms:** Config changes don't apply after editing `saw.config.json`

**Fix:** Restart the server:
```bash
pkill -f "saw serve"
saw serve
```

The server only loads config on startup.

---

## See Also

- [CLI Reference](cli-reference.md) — Command-line flags and options
- [API Reference](api-reference.md) — `GET /api/config` and `POST /api/config` endpoints
- [Protocol Specification](https://github.com/blackwell-systems/scout-and-wave) — IMPL manifest structure

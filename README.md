# lovstudio

Install and activate [Lovstudio](https://lovstudio.ai) skills with one command.

```bash
npx lovstudio skills add write-professional-book -k lk-<your-key> -y
```

Thin wrapper over two underlying tools — it doesn't reinvent either:

- [`npx skills`](https://www.npmjs.com/package/skills) (vercel-labs) — clones the public [lovstudio/skills](https://github.com/lovstudio/skills) index and installs the skill into your agent (Claude Code, Cursor, Cline, Codex, Gemini CLI, … 40+ agents supported)
- [`uvx lovstudio-skill-helper`](https://pypi.org/project/lovstudio-skill-helper/) — license activation + per-invocation decryption for paid skills. Decryption keys never touch disk.

## Usage

```bash
npx lovstudio skills add <name> [options]    # install a skill
npx lovstudio skills activate <key>          # activate/rebind a license
npx lovstudio skills list                    # list all available skills
```

### `skills add` options

| flag | meaning |
|---|---|
| `-k, --key <key>` | license key (`lk-<64 hex>`). If given, activates before install. |
| `-a, --agent <agents>` | target agent(s), comma-separated. Omit for interactive pick. |
| `-g, --global` | install to user scope instead of the current project |
| `-y, --yes` | skip confirmation prompts |

### Examples

```bash
# paid skill, buyer has a license already
npx lovstudio skills add write-professional-book -k lk-abc... -y

# install now, activate later (paid skill won't decrypt until activated)
npx lovstudio skills add write-professional-book -y
npx lovstudio skills activate lk-abc...

# install into Cursor instead of Claude Code
npx lovstudio skills add write-professional-book -a cursor -y

# install into multiple agents at once
npx lovstudio skills add write-professional-book -a claude-code,cursor,cline -y
```

## Requirements

- **Node.js ≥18** (for `npx`) — any recent Node works
- **[uv](https://docs.astral.sh/uv/)** (for `uvx` — only needed for paid skills)
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

Free skills install without `uv`. You only need it to decrypt paid skills at runtime.

## How it works

1. If you pass `-k`, runs `uvx lovstudio-skill-helper activate <key>` — opens a browser to sign you into Lovstudio, then binds the license to your device.
2. Runs `npx skills add lovstudio/skills -s lovstudio:<name>` — clones the public index and copies the skill (a plaintext SKILL.md for free skills, or a tiny encrypted placeholder for paid ones) into your agent's skill directory.
3. First time your agent loads a paid skill, the placeholder calls `uvx lovstudio-skill-helper decrypt <name>` which fetches the per-version AES key over HMAC, decrypts in memory, and streams the real SKILL.md back to the agent.

## License

MIT.

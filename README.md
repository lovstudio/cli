# lovstudio

One CLI for Lovstudio users and ops: install skills, activate license keys, and manage the lovstudio.ai domain.

```bash
npx lovstudio --help
```

## For end users

```bash
# Activate your license (one-time)
npx lovstudio license <your-license-key>

# Install a skill + preflight its runtime deps, auto-installing any that are missing
npx lovstudio skills add wxmp-cracker --with-deps

# List all skills in the catalog
npx lovstudio skills list
```

`skills add` resolves the skill's `dependencies:` frontmatter (shipped in the
encrypted placeholder SKILL.md) and runs each `check` command. With
`--with-deps`, missing ones are installed automatically via their declared
`install` command.

Under the hood:
- `skills add` → `npx skills add lovstudio/skills --skill lovstudio:<name>` (vercel-labs/skills)
- `license *` → `uvx lovstudio-skill-helper *` (pinned version)

## For ops

```bash
lovstudio dns status                # show registrar + public resolver + mode
lovstudio dns cf                    # switch registrar NS -> Cloudflare
lovstudio dns aliyun                # switch registrar NS -> Aliyun (CN split-horizon)
lovstudio dns sync --apply          # apply missing records to Aliyun
lovstudio license issue [options]   # admin-only: mint license keys
```

### Environment (dns)

```
GODADDY_API_KEY      # registrar API key
GODADDY_SECRET       # registrar API secret
CLOUDFLARE_API_KEY   # CF token with Zone.DNS read
ALI_AK               # Aliyun AccessKey ID
ALI_SK               # Aliyun AccessKey Secret
```

Proxy: honors `HTTPS_PROXY` / `HTTP_PROXY` (useful in mainland China).

## Install

```bash
# one-off
npx lovstudio skills list

# or global
pnpm add -g lovstudio
lovstudio skills list
```

Requires Node ≥18. `license *` commands additionally require [uv](https://astral.sh/uv).

## Adding a new command

1. Create `src/commands/<name>/index.mjs` exporting `{ summary, run(args) }`.
2. Register it in `src/index.mjs` `COMMANDS`.
3. That's it.

## License

MIT

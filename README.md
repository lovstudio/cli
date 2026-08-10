# lovstudio

One CLI for Lovstudio users: install skills and activate license keys.

```bash
npx lovstudio --help
```

## For end users

```bash
# Install a free Skill directly
npx lovstudio skills add any2pdf

# Install a paid Skill (the command signs in, asks for Credits, then downloads
# the encrypted bundle)
npx lovstudio skills add subtitle-freedom

# Install a skill + preflight its runtime deps, auto-installing any that are missing
npx lovstudio skills add wxmp-cracker --with-deps

# Install all free Skills globally; add paid Skills individually
npx lovstudio skills add skills -g -y

# List all skills in the catalog
npx lovstudio skills list
```

`skills add` reads the unified `lovstudio/skills` catalog before installation.
Free Skills install directly. Paid Skills must have an encrypted bundle; the
CLI signs in to Lovstudio, confirms the current Credits price, completes the
redemption, and only then downloads the bundle. The encrypted placeholder
uses the same account entitlement at runtime, so plaintext Skill code is not
written to disk.

The command also resolves the Skill's `dependencies:` frontmatter and runs each
`check` command. With `--with-deps`, missing ones are installed automatically
via their declared `install` command.

Under the hood:
- `skills add <name>` → `npx -y skills@latest add lovstudio/skills --skill lovstudio-<name>` (vercel-labs/skills)
- `skills add skills` → resolves the unified catalog and passes all free `lovstudio-<name>` selectors
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
On Windows, use the same commands from PowerShell; the CLI resolves npm's
`npx.cmd` shim internally.

## Adding a new command

1. Create `src/commands/<name>/index.mjs` exporting `{ summary, run(args) }`.
2. Register it in `src/index.mjs` `COMMANDS`.
3. That's it.

## License

MIT

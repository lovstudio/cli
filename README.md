# @lovstudio/admin

Lovstudio internal ops CLI — DNS, deploy, release.

```bash
npx @lovstudio/admin --help
```

## DNS

Manage `lovstudio.ai` DNS provider + records.

```bash
lovstudio dns status                # show registrar + public resolver + mode
lovstudio dns cf                    # switch registrar NS -> Cloudflare
lovstudio dns aliyun                # switch registrar NS -> Aliyun (CN split-horizon)
lovstudio dns sync                  # dry-run: CF -> Aliyun standby sync
lovstudio dns sync --apply          # apply missing records to Aliyun
```

### Environment

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
npx @lovstudio/admin dns status

# or global
pnpm add -g @lovstudio/admin
lovstudio dns status
```

## Adding a new command

1. Create `src/commands/<name>/index.mjs` exporting `{ summary, run(args) }`.
2. Register it in `src/index.mjs` `COMMANDS`.
3. That's it.

## Related

- **`lovcode`** — the public product CLI for end users (separate package, TBD).
- **`@lovstudio/admin`** — this package, internal ops.

## License

MIT

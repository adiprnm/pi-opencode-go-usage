# pi-opencode-go-usage

A [Pi](https://pi.dev) extension that adds the `/go-usage` command, showing your
[OpenCode Go](https://opencode.ai/go) allowance for the 5-hour rolling, weekly,
and monthly windows as a horizontal bar chart.

```
OpenCode Go usage

  5 hour   █░░░░░░░░░░░░░░░░░░░░░░░   5%  resets in 18m

  Weekly   ██░░░░░░░░░░░░░░░░░░░░░░   7%  resets in 3d 13h

  Monthly  ██████░░░░░░░░░░░░░░░░░░  25%  resets in 22d 19h
```

Press `Esc` to close the panel. Bars turn yellow at 60% and red at 90% or when
a window is rate-limited.

## Install

From git:

```bash
pi install git:github.com/adiprnm/pi-opencode-go-usage
```

Pinned to a release:

```bash
pi install git:github.com/adiprnm/pi-opencode-go-usage@v1.0.0
```

Try it without installing:

```bash
pi -e git:github.com/adiprnm/pi-opencode-go-usage
```

Local checkout:

```bash
git clone https://github.com/adiprnm/pi-opencode-go-usage
pi install ./pi-opencode-go-usage
```

Then run `/go-usage` inside Pi. Use `pi remove <source>` to uninstall.

## Credentials

The extension reads your OpenCode Go API key from the first source that has one:

1. `OPENCODE_GO_API_KEY` environment variable
2. `apiKey` in `<agent-dir>/opencode-go.json`
3. The `opencode-go` (or `opencode`) entry in `<agent-dir>/auth.json`

`<agent-dir>` defaults to `~/.pi/agent`. So if you already use the `opencode-go`
provider in Pi, it works without any extra setup.

A key value starting with `!` is run as a shell command, which lets you keep the
secret in a password manager:

```json
{
  "apiKey": "!op read op://Private/opencode-go/credential"
}
```

## Configuration

Optional `<agent-dir>/opencode-go.json`:

```json
{
  "apiKey": "oc_sk_...",
  "baseUrl": "https://opencode.ai/zen/go/v1/usage"
}
```

| Field     | Default                                    | Description                          |
| --------- | ------------------------------------------ | ------------------------------------ |
| `apiKey`  | —                                          | Explicit key, or `!command` to fetch |
| `baseUrl` | `https://opencode.ai/zen/go/v1/usage`      | Usage endpoint                       |

## How it works

`/go-usage` sends a single authenticated `GET` request to the usage endpoint and
renders the returned percentages. Data is fetched on demand only; nothing runs
in the background and no status is added to the footer.

In non-interactive modes (`pi -p "/go-usage"`), the chart is printed as plain
text without ANSI colors.

## License

MIT

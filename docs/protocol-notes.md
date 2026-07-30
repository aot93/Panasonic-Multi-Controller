# NTCONTROL protocol — implementation notes

This records the confirmed wire protocol and where earlier guesses (from the
spec's illustrative snippet, or from the older working Python scripts) turned
out to be wrong. Read this before touching `packages/backend/src/protocol/`.

## Sources, ranked by trust

The source files below moved to `_old/` (pending review/removal — not
referenced by any code, just historical reference material this doc cites).
Paths here reflect that; update again if they're actually deleted.

1. **`PTRQ-CONNECTION.pdf`** (`_old/PTRQ-CONNECTION.pdf`, extracted to
   `docs/ptrq-connection.txt`) — Panasonic's official "Control commands via
   LAN" appendix. This is now the authority on the handshake, framing, and
   error format. Everything below is sourced from it unless noted.
2. **`rq35_rz34_command_list_1606346081.8208.pdf`** (`_old/rq35_rz34_command_list_1606346081.8208.pdf`,
   extracted to `docs/panasonic-command-list.txt`) — authority on command
   *bodies* (`VSE:6`, `QTM:0`, etc). Does not cover handshake/framing at all
   (confirmed by grepping it for "NTCONTROL" — no hits).
3. **`panasonic_aspectQ.py`, `panasonic_setup_Script.py`, `panasonic_query.py`**
   (`_old/`) — working scripts against real hardware. Useful for real
   credentials-in-practice and confirm the general shape, but see "Where the
   old scripts are subtly wrong" below — they predate this confirmed spec and
   get one detail wrong in a way that could silently misread a device's power
   state.
4. **Spec §4's Python snippet** — superseded entirely; kept no weight now that
   the official appendix is available.

## Confirmed handshake

On connect, the projector sends a banner (ASCII, CR-terminated, no LF):

- Non-protect mode: `"NTCONTROL 0"` + CR
- Protect mode: `"NTCONTROL 1 " + 8-hex-char-challenge` + CR for **MD5**
- Protect mode: `"NTCONTROL 2 " + 8-hex-char-challenge` + CR for **SHA-256**

The mode digit is which hash algorithm *that specific projector* is
configured to require ([NETWORK] → [NETWORK SECURITY] → [COMMAND PROTECT] =
`ENABLE(MD5)` / `ENABLE(SHA-256)` / `DISABLE`). The client detects this live
from the banner every connection — it is not something we configure or store
per device.

Auth hash = `MD5("user:pass:challenge")` or `SHA256("user:pass:challenge")`,
hex-encoded lowercase (32 or 64 hex chars respectively). This matches what
the old working scripts already did for MD5 (`admin1:panasonic:...` /
`dispadmin:@Panasonic:...`) — confirms the username IS part of the digest and
is not optional, and confirms the colon-joined format.

## Confirmed framing

**Every command sent in protect mode is individually prefixed with the same
hash** — the hash is computed once per session (from that session's
challenge) and prepended to every command frame sent on that connection, not
just the first:

```
<hash: 32 or 64 hex chars><"00"><control command><CR>
```

Non-protect mode omits the hash entirely:

```
<"00"><control command><CR>
```

Example from the spec (protect/MD5): `"dbdd2dabd3d4d68c5dd970ec0c29fa6400QPW"` + CR
— 32 hex chars, then `"00"`, then `"QPW"`.

**Responses also carry the fixed `"00"` header before the payload** —
confirmed by the received-data table and the worked example
`"00001"` (CR) for "projector is powered on" (`"00"` + `"001"`, and `QPW`
responses are `000`=off / `001`=on per the command list).

### Where the old scripts are subtly wrong

`panasonic_query.py` and friends do `response.lstrip('000')` on the raw
response. That is a **latent bug**: a legitimate power-off response is
literally `"00000"` on the wire (`"00"` header + `"000"` off) — `lstrip('000')`
strips the *entire* string, leaving `""`, which would misparse "off" as
nothing. The correct parse is to strip exactly the first 2 characters (the
fixed header), never a variable run of zeros. `packages/backend/src/protocol/framing.ts`
does this correctly (`parseResponseFrame`).

### Error responses

Errors are **not** prefixed with the `"00"` header — they're the bare token
plus CR. Confirmed set:

| Token | Meaning |
|---|---|
| `ERR1` | Undefined control command |
| `ERR2` | Parameter out of range |
| `ERR3` | Busy / not acceptable right now |
| `ERR4` | Timeout / not acceptable right now |
| `ERR5` | Wrong data length |
| `ERRA` | Password mismatch (protect mode only) |
| `ERRA ***` | Access temporarily blocked after 3 consecutive bad passwords — `***` is the remaining lockout in **seconds** |

`ERR5` ("wrong data length") and the `ERRA ***` lockout form were not in the
spec's original error list — both are now handled explicitly.

## Session behavior — resolves the phase 1 open question

Phase 1's notes flagged "does the auth hash need resending every command, or
once per connection?" as unresolved. It's now answered directly:

> "The projector is initially set to disconnect the session right after the
> response to a command received from the client, until it receives another
> connection request. [...] To send/receive multiple commands continuously,
> set [NETWORK] → [NETWORK CONTROL] → [COMMAND SESSION PROLONG] to [30SEC.]"

So **the default is one command per TCP connection** — the projector itself
closes the socket after every response. This is exactly what the old
scripts' repeated `connect()`-before-every-command pattern was working around
(not defensive habit, as phase 1's notes guessed — it's a hard requirement
against the default configuration).

Implication for the client (`packages/backend/src/protocol/client.ts`):
default behavior is connect → handshake → send one command → read response →
close, repeated per command. Devices with `COMMAND SESSION PROLONG` enabled
can reuse a connection for up to 30s between commands, so the client exposes
both a one-shot `sendOnce()` and a session-based `NtControlSession` for
callers (the phase 3 poller, batch dispatch) that want to pipeline several
commands without paying reconnect+handshake cost every time — but it never
assumes session reuse works, since that depends on a per-device menu setting
we don't control.

## Still open (not covered by either PDF)

- **`QVX:ERRS1` / `ERRS2` self-diagnosis format** — partially resolved by
  real-hardware evidence (still not from either PDF): `ERRS2` returns the
  literal active code as text (confirmed: `"ERRS2=H001"`); `ERRS1` returns a
  long fixed-width positional field (confirmed: 511 characters, all `'N'`
  except a single `'E'`) where `'N'` means normal at that position. The
  actual code meanings came from `data/logs/errorcodes.md`, a table the user
  hardware-tested independently — see `shared/src/self-diagnosis.ts`.
  **Still open:** which position in `ERRS1` corresponds to which specific
  U/F-prefixed code — that mapping is not documented anywhere available and
  wasn't cross-referenced against the unit's own on-screen display at
  capture time, so `ERRS1` findings are surfaced as "unidentified, active at
  position N" rather than a named code. Would need either an official
  position table or several more real captures paired with what the
  projector's own display showed at the same moment.
- **Where the admin password is actually configured** — the connection
  appendix cross-references "page 240" of the full manual ("necessary to set
  the password of the administrator account") for setting it on the
  projector itself. Out of scope for this app (that's done via the
  projector's own menu/web UI), but worth knowing technicians must set a
  non-default admin password on each unit before this app can authenticate
  against it in protect mode.

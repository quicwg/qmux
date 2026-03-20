# QMux Codepoints

This file tracks codepoints for all QUIC extension points defined by QMux,
across all draft versions. It is the source of truth for codepoint values used
in the draft document.

## Workflow

When preparing a new draft version:

1. Ensure `quic-pick.html` is up to date: `make update-quic-pick`
2. Ensure the previous version is tagged (required as part of the publish workflow any way
3. Generate codepoints for the next version: `make codepoints`
4. Apply the new values to the draft: `make apply-codepoints`
5. Review the changes, then commit everything together.

## Selection column

Each row records how its codepoint was selected:

- **quic-pick URL** — selected deterministically using [quic-pick](https://martinthomson.github.io/quic-pick/)
  with a seed of `<draft-version>_<fieldtype>` (e.g. `draft-ietf-quic-qmux-01_frame`).
  The URL embeds the codepoint value; if the link shows a "changed" warning, the
  value no longer matches what quic-pick would produce for that seed, which
  indicates the quic-pick algorithm or IANA registry has changed.
- **consecutive with above** — this value is one higher than the preceding quic-pick row
  (used for consecutive frame type pairs such as QX_PING request/response).
- **Magic Value** — a deliberately chosen value with semantic meaning (e.g. a protocol
  magic number). This value is fixed and will never be updated by the tooling.
- **Manual Selection** — selected by hand, not via quic-pick. Typically only appears
  in early draft versions before the quic-pick workflow was established.

## QUIC Frame Types

| Name | Codepoint | Draft version | Selection |
|---|---|---|---|
| QX_PING (request) | 0x348c67529ef8c7bd | draft-ietf-quic-qmux-01 | https://martinthomson.github.io/quic-pick/#seed=draft-ietf-quic-qmux-01_frame;field=frame;codepoint=0x348c67529ef8c7bd;count=2;size=8 |
| QX_PING (request) | 0xTBD | draft-ietf-quic-qmux-00 | Manual Selection |
| QX_PING (response) | 0x348c67529ef8c7be | draft-ietf-quic-qmux-01 | (consecutive with above) |
| QX_PING (response) | 0xTBD+1 | draft-ietf-quic-qmux-00 | Manual Selection |
| QX_TRANSPORT_PARAMETERS | 0x3f5153300d0a0d0a | draft-ietf-quic-qmux-01 | Magic Value |
| QX_TRANSPORT_PARAMETERS | 0x3f5153300d0a0d0a | draft-ietf-quic-qmux-00 | Magic Value |

## QUIC Transport Parameters

| Name | Codepoint | Draft version | Selection |
|---|---|---|---|
| max_record_size | 0x0571c59429cd0845 | draft-ietf-quic-qmux-01 | https://martinthomson.github.io/quic-pick/#seed=draft-ietf-quic-qmux-01_tp;field=tp;codepoint=0x0571c59429cd0845;size=8 |
| max_frame_size | 0xTBD | draft-ietf-quic-qmux-00 | Manual Selection |

## QUIC Transport Error Codes

| Name | Codepoint | Draft version | Selection |
|---|---|---|---|

## QUIC Versions

| Name | Codepoint | Draft version | Selection |
|---|---|---|---|

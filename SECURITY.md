# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration only reads the Scrutiny web server at the address set in its
configuration (`GET` requests, on your local network); it never contacts
anything else and never touches the disks. The optional proxy user and
password are stored by Gladys and sent only to that address, as basic
authentication; redirects are not followed. The volume `/data` only holds
`scrutiny-state.json`: the last health of each disk (by WWN) and whether its
collection was stale, to announce each change once.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Scrutiny, its collector and the disks it reads.

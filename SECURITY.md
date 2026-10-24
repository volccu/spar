# Security

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. That sends the report to the maintainer alone and keeps it private
until a fix is released.

Please include what you found, how to reproduce it, and which version or commit you tested. You
will get an answer as soon as possible. A confirmed problem is fixed in a release, and the release
notes credit you unless you ask not to be named.

## Scope

spår keeps notes in the browser and optionally syncs them to a Supabase project that the person
running it controls. Reports about the app, its database migrations (including row level security)
and its edge functions are all in scope. Problems in Supabase itself, or in a particular
deployment's configuration, belong with that project or with whoever runs the deployment.

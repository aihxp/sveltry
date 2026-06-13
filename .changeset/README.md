# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). Hop on over to
their docs to learn more.

Only published packages are versioned through changesets. Right now that is the SDK
(`@aihxp/sveltry-sdk`); the apps and internal packages are listed under `ignore` in
`config.json`.

To record a change that should appear in a release, run:

```sh
bunx changeset
```

and follow the prompts.

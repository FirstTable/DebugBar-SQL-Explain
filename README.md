# DebugBar SQL Explain

EXPLAIN tooling for [lekoala/silverstripe-debugbar](https://github.com/lekoala/silverstripe-debugbar).

Adds an **EXPLAIN** button on DebugBar database query rows, keeps typed bound parameters (so EXPLAIN matches what actually ran), and serves `POST /__debugbar/explain` for admins in dev.

## Requirements

- PHP ^8.3
- SilverStripe 5
- `lekoala/silverstripe-debugbar` ^3 (require-dev in the host app)

## Install

```bash
composer require --dev firsttable/debugbar-sql-explain
```

Config and Injector replacements load only when DebugBar is present (`Only: moduleexists`). With `--no-dev`, both this package and DebugBar are omitted.

## What it replaces

| DebugBar service | This package |
| --- | --- |
| `ProxyDBExtension` | records typed statement parameters |
| `ControllerExtension` | loads EXPLAIN assets + parameters collector |
| `DebugBarController` | adds the `explain` action |

## License

Proprietary — First Table.

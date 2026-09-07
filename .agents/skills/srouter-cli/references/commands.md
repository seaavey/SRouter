# Commands

## setup

Interactive onboarding flow.

Responsibilities:

- detect installed tools
- configure gateway URL
- configure API keys/models
- create backups before writes

Uses `@clack/prompts` heavily.

## init

Bootstrap local SRouter gateway.

Supports:

- docker mode
- source mode
- detached startup

## link

Direct adapter configuration.

Requirements:

- backup support
- dry-run mode
- idempotent writes

## unlink

Rollback command.

Must restore original configs from backups.

## status / doctor

Diagnostics flow.

Checks:

- gateway connectivity
- linked adapters
- config validity
- environment state

## sync

Refreshes provider/model state from gateway.

## env

Outputs shell-compatible exports.

Supported shells:

- bash
- zsh
- fish
- powershell
- cmd

## run

Runs tool process with temporary proxy environment injection.

Avoid permanent shell mutation.

## migrate

Legacy migration support.

Supports:

- SQLite migration
- JSON migration
- 9Router import

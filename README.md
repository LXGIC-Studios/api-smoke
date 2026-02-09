# @lxgicstudios/api-smoke

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/api-smoke)](https://www.npmjs.com/package/@lxgicstudios/api-smoke)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Run smoke tests on your API endpoints from a simple YAML config. Define endpoints, methods, expected status codes, and body assertions. Run sequentially or in parallel, across different environments.

**One dependency:** `js-yaml` for YAML parsing. That's it.

## Install

```bash
npm install -g @lxgicstudios/api-smoke
```

Or run directly:

```bash
npx @lxgicstudios/api-smoke run tests.yaml
```

## Quick Start

Generate a sample config:

```bash
api-smoke init
```

Edit the generated `smoke-tests.yaml`, then run:

```bash
api-smoke run smoke-tests.yaml
```

## Usage

### Run tests

```bash
api-smoke run tests.yaml
```

### Run against a specific environment

```bash
api-smoke run tests.yaml --env staging
```

### Run in parallel

```bash
api-smoke run tests.yaml --parallel
```

### Bail on first failure

```bash
api-smoke run tests.yaml --bail
```

### Validate config syntax

```bash
api-smoke validate tests.yaml
```

## Config Format

```yaml
environments:
  default:
    baseUrl: https://api.example.com
    headers:
      Authorization: "Bearer token123"
  staging:
    baseUrl: https://staging.api.example.com

tests:
  - name: Health check
    path: /health
    method: GET
    expect:
      status: 200
      body:
        status: "ok"

  - name: Create user
    path: /users
    method: POST
    headers:
      Content-Type: application/json
    body:
      name: "Test User"
    expect:
      status: 201
      bodyContains: "id"
      bodyNotContains: "error"
```

## Features

- YAML-based test configuration
- Multiple environment support (dev, staging, production)
- Sequential and parallel test execution
- Bail on first failure for fast feedback
- Status code assertions
- Body field matching
- Body contains/not-contains checks
- Header assertions
- Custom headers and request bodies per test
- Colorful terminal output with pass/fail indicators
- JSON output mode for CI/CD pipelines
- Config validation command
- Sample config generator

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Show help message | |
| `--json` | | Output results as JSON | `false` |
| `--env <name>` | `-e` | Use environment from config | `default` |
| `--parallel` | `-p` | Run tests in parallel | `false` |
| `--bail` | `-b` | Stop on first failure | `false` |
| `--timeout <ms>` | `-t` | Global request timeout | `10000` |
| `--verbose` | `-v` | Show response details for passing tests | `false` |

## Commands

| Command | Description |
|---------|-------------|
| `run <config.yaml>` | Run smoke tests from config |
| `init` | Generate a sample config file |
| `validate <config.yaml>` | Validate config syntax |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | One or more tests failed |

---

**Built by [LXGIC Studios](https://lxgicstudios.com)**

[GitHub](https://github.com/lxgicstudios/api-smoke) | [Twitter](https://x.com/lxgicstudios)

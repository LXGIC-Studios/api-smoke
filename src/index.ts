#!/usr/bin/env node

import https from "node:https";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { URL } from "node:url";
import yaml from "js-yaml";

// ── ANSI Colors ──
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

// ── Helpers ──
function printBanner(): void {
  console.log(`
${c.cyan}${c.bold}  ╔══════════════════════════════════╗
  ║        🔥 api-smoke               ║
  ║   API Smoke Test Runner           ║
  ╚══════════════════════════════════╝${c.reset}
`);
}

function printHelp(): void {
  printBanner();
  console.log(`${c.bold}USAGE${c.reset}
  ${c.cyan}api-smoke run${c.reset} <config.yaml>       Run smoke tests from config
  ${c.cyan}api-smoke init${c.reset}                    Generate a sample config file
  ${c.cyan}api-smoke validate${c.reset} <config.yaml>  Validate config syntax

${c.bold}OPTIONS${c.reset}
  ${c.green}--help${c.reset}                Show this help message
  ${c.green}--json${c.reset}                Output results as JSON
  ${c.green}--env <name>${c.reset}          Use environment from config (default: "default")
  ${c.green}--parallel${c.reset}            Run tests in parallel (default: sequential)
  ${c.green}--bail${c.reset}                Stop on first failure
  ${c.green}--timeout <ms>${c.reset}        Global request timeout (default: 10000)
  ${c.green}--verbose${c.reset}             Show response details for each test

${c.bold}CONFIG FORMAT${c.reset} (YAML)
  ${c.dim}environments:
    default:
      baseUrl: https://api.example.com
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
        bodyContains: "id"${c.reset}

${c.bold}EXAMPLES${c.reset}
  ${c.dim}$ api-smoke run tests.yaml${c.reset}
  ${c.dim}$ api-smoke run tests.yaml --env staging --parallel${c.reset}
  ${c.dim}$ api-smoke run tests.yaml --bail --timeout 5000${c.reset}
  ${c.dim}$ api-smoke init${c.reset}
`);
}

interface ParsedArgs {
  command: string;
  configFile: string | null;
  json: boolean;
  env: string;
  parallel: boolean;
  bail: boolean;
  timeout: number;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    configFile: null,
    json: false,
    env: "default",
    parallel: false,
    bail: false,
    timeout: 10000,
    verbose: false,
    help: false,
  };

  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--parallel":
      case "-p":
        result.parallel = true;
        break;
      case "--bail":
      case "-b":
        result.bail = true;
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
      case "--env":
      case "-e":
        result.env = argv[++i] || "default";
        break;
      case "--timeout":
      case "-t":
        result.timeout = parseInt(argv[++i], 10) || 10000;
        break;
      default:
        if (!arg.startsWith("-")) {
          if (positional === 0) result.command = arg;
          else if (positional === 1) result.configFile = arg;
          positional++;
        }
        break;
    }
  }

  return result;
}

interface TestCase {
  name: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
  expect: {
    status?: number;
    body?: Record<string, any>;
    bodyContains?: string | string[];
    bodyNotContains?: string | string[];
    headerContains?: Record<string, string>;
  };
}

interface SmokeConfig {
  environments?: Record<string, { baseUrl: string; headers?: Record<string, string> }>;
  tests: TestCase[];
}

interface TestResult {
  name: string;
  passed: boolean;
  status: number | null;
  expectedStatus: number | null;
  responseTime: number;
  assertions: { check: string; passed: boolean; detail?: string }[];
  error: string | null;
}

function loadConfig(filePath: string): SmokeConfig {
  if (!existsSync(filePath)) {
    console.error(`${c.red}Error: Config file not found: ${filePath}${c.reset}`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf-8");
  const config = yaml.load(raw) as SmokeConfig;

  if (!config || !config.tests || !Array.isArray(config.tests)) {
    console.error(`${c.red}Error: Config must have a 'tests' array.${c.reset}`);
    process.exit(1);
  }

  return config;
}

async function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: any,
  timeout: number
): Promise<{ status: number; headers: Record<string, string>; body: any; bodyRaw: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;

    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      "User-Agent": "api-smoke/1.0.0",
      ...headers,
    };
    if (bodyStr && !reqHeaders["Content-Type"]) {
      reqHeaders["Content-Type"] = "application/json";
    }

    const req = client.request(url, { method, headers: reqHeaders, timeout }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: any = rawBody;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {}

        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val) responseHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
        }

        resolve({ status: res.statusCode || 0, headers: responseHeaders, body: parsedBody, bodyRaw: rawBody });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function checkAssertions(
  test: TestCase,
  response: { status: number; headers: Record<string, string>; body: any; bodyRaw: string }
): { check: string; passed: boolean; detail?: string }[] {
  const results: { check: string; passed: boolean; detail?: string }[] = [];

  // Status check
  if (test.expect.status !== undefined) {
    const passed = response.status === test.expect.status;
    results.push({
      check: `Status is ${test.expect.status}`,
      passed,
      detail: passed ? undefined : `Got ${response.status}`,
    });
  }

  // Body field checks
  if (test.expect.body) {
    for (const [key, expected] of Object.entries(test.expect.body)) {
      const actual = typeof response.body === "object" ? response.body?.[key] : undefined;
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      results.push({
        check: `body.${key} === ${JSON.stringify(expected)}`,
        passed,
        detail: passed ? undefined : `Got ${JSON.stringify(actual)}`,
      });
    }
  }

  // Body contains
  if (test.expect.bodyContains) {
    const checks = Array.isArray(test.expect.bodyContains)
      ? test.expect.bodyContains
      : [test.expect.bodyContains];
    for (const term of checks) {
      const passed = response.bodyRaw.includes(term);
      results.push({
        check: `Body contains "${term}"`,
        passed,
      });
    }
  }

  // Body not contains
  if (test.expect.bodyNotContains) {
    const checks = Array.isArray(test.expect.bodyNotContains)
      ? test.expect.bodyNotContains
      : [test.expect.bodyNotContains];
    for (const term of checks) {
      const passed = !response.bodyRaw.includes(term);
      results.push({
        check: `Body doesn't contain "${term}"`,
        passed,
      });
    }
  }

  // Header checks
  if (test.expect.headerContains) {
    for (const [key, expected] of Object.entries(test.expect.headerContains)) {
      const actual = response.headers[key.toLowerCase()];
      const passed = actual ? actual.includes(expected) : false;
      results.push({
        check: `Header ${key} contains "${expected}"`,
        passed,
        detail: passed ? undefined : `Got "${actual || "(missing)}"`,
      });
    }
  }

  return results;
}

async function runTest(
  test: TestCase,
  baseUrl: string,
  envHeaders: Record<string, string>,
  timeout: number
): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    name: test.name,
    passed: false,
    status: null,
    expectedStatus: test.expect.status || null,
    responseTime: 0,
    assertions: [],
    error: null,
  };

  try {
    const url = `${baseUrl}${test.path}`;
    const headers = { ...envHeaders, ...(test.headers || {}) };
    const response = await makeRequest(url, test.method || "GET", headers, test.body, timeout);

    result.responseTime = Date.now() - start;
    result.status = response.status;
    result.assertions = checkAssertions(test, response);
    result.passed = result.assertions.every((a) => a.passed);
  } catch (err: any) {
    result.responseTime = Date.now() - start;
    result.error = err.message;
    result.passed = false;
  }

  return result;
}

function printTestResult(result: TestResult, verbose: boolean): void {
  const icon = result.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const timeStr = `${c.dim}${result.responseTime}ms${c.reset}`;
  console.log(`  ${icon} ${c.bold}${result.name}${c.reset}  ${timeStr}`);

  if (result.error) {
    console.log(`    ${c.red}Error: ${result.error}${c.reset}`);
    return;
  }

  if (!result.passed || verbose) {
    for (const assertion of result.assertions) {
      const aIcon = assertion.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
      let line = `    ${aIcon} ${assertion.check}`;
      if (assertion.detail) line += ` ${c.dim}(${assertion.detail})${c.reset}`;
      console.log(line);
    }
  }
}

function printRunSummary(results: TestResult[], duration: number): void {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`\n${c.bold}${c.cyan}─── Results ───${c.reset}`);
  console.log(
    `  Tests: ${c.bold}${total}${c.reset}  |  ${c.green}Passed: ${passed}${c.reset}  |  ${c.red}Failed: ${failed}${c.reset}  |  Duration: ${c.dim}${duration}ms${c.reset}`
  );

  if (failed === 0) {
    console.log(`\n  ${c.green}${c.bold}All tests passed!${c.reset}\n`);
  } else {
    console.log(`\n  ${c.red}${c.bold}${failed} test(s) failed.${c.reset}\n`);
  }
}

async function cmdRun(args: ParsedArgs): Promise<void> {
  if (!args.configFile) {
    console.error(`${c.red}Error: Config file required. Usage: api-smoke run <config.yaml>${c.reset}`);
    process.exit(1);
  }

  const config = loadConfig(args.configFile);
  const env = config.environments?.[args.env] || config.environments?.["default"];
  const baseUrl = env?.baseUrl || "";
  const envHeaders = env?.headers || {};

  if (!args.json) {
    console.log(`  ${c.cyan}Environment:${c.reset} ${args.env}`);
    if (baseUrl) console.log(`  ${c.cyan}Base URL:${c.reset} ${baseUrl}`);
    console.log(`  ${c.cyan}Tests:${c.reset} ${config.tests.length}`);
    console.log(`  ${c.cyan}Mode:${c.reset} ${args.parallel ? "parallel" : "sequential"}${args.bail ? " (bail on failure)" : ""}\n`);
  }

  const startTime = Date.now();
  const results: TestResult[] = [];

  if (args.parallel) {
    const promises = config.tests.map((test) =>
      runTest(test, baseUrl, envHeaders, args.timeout)
    );
    const settled = await Promise.all(promises);
    results.push(...settled);

    if (!args.json) {
      for (const result of results) {
        printTestResult(result, args.verbose);
      }
    }
  } else {
    for (const test of config.tests) {
      const result = await runTest(test, baseUrl, envHeaders, args.timeout);
      results.push(result);

      if (!args.json) {
        printTestResult(result, args.verbose);
      }

      if (args.bail && !result.passed) {
        if (!args.json) {
          console.log(`\n  ${c.red}Bailing out after first failure.${c.reset}`);
        }
        break;
      }
    }
  }

  const duration = Date.now() - startTime;

  if (args.json) {
    console.log(
      JSON.stringify({
        environment: args.env,
        baseUrl,
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        duration,
        results,
      }, null, 2)
    );
  } else {
    printRunSummary(results, duration);
  }

  if (results.some((r) => !r.passed)) process.exit(1);
}

function cmdInit(): void {
  const sampleConfig = `# api-smoke configuration
# Run with: api-smoke run smoke-tests.yaml

environments:
  default:
    baseUrl: https://api.example.com
    headers:
      Authorization: "Bearer your-token-here"
  staging:
    baseUrl: https://staging.api.example.com
  production:
    baseUrl: https://api.example.com

tests:
  - name: Health check
    path: /health
    method: GET
    expect:
      status: 200
      body:
        status: "ok"

  - name: List users
    path: /users
    method: GET
    expect:
      status: 200
      bodyContains: "id"

  - name: Create user
    path: /users
    method: POST
    headers:
      Content-Type: application/json
    body:
      name: "Smoke Test User"
      email: "smoke@test.com"
    expect:
      status: 201
      bodyContains: "id"
      bodyNotContains: "error"

  - name: Not found returns 404
    path: /nonexistent
    method: GET
    expect:
      status: 404
`;

  const filename = "smoke-tests.yaml";
  writeFileSync(filename, sampleConfig);
  console.log(`  ${c.green}✓ Created ${filename}${c.reset}`);
  console.log(`  ${c.dim}Edit the file, then run: api-smoke run ${filename}${c.reset}\n`);
}

function cmdValidate(args: ParsedArgs): void {
  if (!args.configFile) {
    console.error(`${c.red}Error: Config file required. Usage: api-smoke validate <config.yaml>${c.reset}`);
    process.exit(1);
  }

  try {
    const config = loadConfig(args.configFile);
    let warnings = 0;

    for (let i = 0; i < config.tests.length; i++) {
      const test = config.tests[i];
      if (!test.name) {
        console.log(`  ${c.yellow}Warning: Test #${i + 1} doesn't have a name.${c.reset}`);
        warnings++;
      }
      if (!test.path) {
        console.log(`  ${c.red}Error: Test "${test.name || `#${i + 1}`}" doesn't have a path.${c.reset}`);
        process.exit(1);
      }
      if (!test.expect) {
        console.log(`  ${c.yellow}Warning: Test "${test.name}" has no expectations.${c.reset}`);
        warnings++;
      }
    }

    if (args.json) {
      console.log(JSON.stringify({ valid: true, tests: config.tests.length, warnings }));
    } else {
      console.log(`  ${c.green}✓ Config is valid${c.reset}`);
      console.log(`  Tests: ${config.tests.length}`);
      if (config.environments) {
        console.log(`  Environments: ${Object.keys(config.environments).join(", ")}`);
      }
      if (warnings > 0) console.log(`  ${c.yellow}Warnings: ${warnings}${c.reset}`);
      console.log();
    }
  } catch (err: any) {
    console.error(`${c.red}Invalid config: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.command) {
    printHelp();
    process.exit(1);
  }

  if (!args.json) printBanner();

  switch (args.command) {
    case "run":
      await cmdRun(args);
      break;
    case "init":
      cmdInit();
      break;
    case "validate":
      cmdValidate(args);
      break;
    default:
      console.error(`${c.red}Unknown command: ${args.command}. Use --help for usage.${c.reset}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});

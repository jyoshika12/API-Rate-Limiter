# Local HTTP benchmark results

Measured on 7 October 2026. Each workload ran three times with 10,000 requests,
50 concurrent workers and 200 warmup requests. Values below are the median of
each metric across the three runs.

| Workload | Requests/second | p50 | p95 | p99 | Unexpected errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Allowed responses (200) | 2,592 | 16.573 ms | 34.616 ms | 49.609 ms | 0 |
| Blocked responses (429) | 2,437 | 18.017 ms | 33.535 ms | 48.597 ms | 0 |

All 30,000 allowed-workload requests returned 200. All 30,000 blocked-workload
requests returned 429. The workloads use temporary demo-path benchmark keys;
these measurements do not include the extra Redis lookup for generated-key
authentication. Benchmark quotas are separate from the Free/Pro/Admin demo limits.

## Environment

- CPU: Intel Core i7-1255U, 12 logical CPUs; 15.7 GiB total memory.
- Backend: Node v22.15.0 on Windows.
- Redis: 8.0.5 in Ubuntu 26.04 on WSL2, reached through localhost port 6387.
- No public network, frontend rendering or external clients are included.
- Docker was unavailable; a temporary Redis runtime was used, not a container.
- Other host activity can change timings. No before/after speedup is claimed.

Raw results: [allowed 1](http-allowed-1.json), [allowed 2](http-allowed-2.json),
[allowed 3](http-allowed-3.json), [blocked 1](http-blocked-1.json),
[blocked 2](http-blocked-2.json), [blocked 3](http-blocked-3.json).

## Reproduce

Start Redis, then run npm run check, npm test and npm run build.
Run npm run benchmark:http three times, saving each result with BENCH_OUTPUT.
Repeat with BENCH_MODE=blocked. Keep hardware, concurrency and workload unchanged.

The HTTP benchmark includes authentication, the Redis limit check and reading
the response body. npm run benchmark measures only Redis limiter calls; do not
describe its results as API latency. Configured requests/minute are quotas,
not throughput.

## Suggested résumé wording

Built a Redis-based API rate limiter for 3 access tiers; handled approximately
2,600 requests/second with 35 ms p95 response time at 50 concurrent workers in
local HTTP tests. Verified shared quotas across two backend processes.

Describe these figures as local test results, not production capacity.

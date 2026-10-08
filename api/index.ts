import { BunRuntime } from '@effect/platform-bun'

import { main } from '../src/api/server.ts'

main.pipe(BunRuntime.runMain)

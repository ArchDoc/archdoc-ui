#!/usr/bin/env node
import { runStdio } from "./index.js";

await runStdio({ model: process.argv[2] });

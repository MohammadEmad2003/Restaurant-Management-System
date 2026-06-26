/* Minimal colored logger — no external dependency. */
const c = {
  reset: '\x1b[0m', gray: '\x1b[90m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const ts = () => new Date().toISOString().slice(11, 19);

export const logger = {
  info: (m) => console.log(`${c.gray}${ts()}${c.reset} ${c.cyan}ℹ${c.reset}  ${m}`),
  success: (m) => console.log(`${c.gray}${ts()}${c.reset} ${c.green}✔${c.reset}  ${m}`),
  warn: (m) => console.log(`${c.gray}${ts()}${c.reset} ${c.yellow}⚠${c.reset}  ${m}`),
  error: (m) => console.log(`${c.gray}${ts()}${c.reset} ${c.red}✖${c.reset}  ${m}`),
};

export default logger;

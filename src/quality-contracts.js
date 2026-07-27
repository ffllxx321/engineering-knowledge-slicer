// @ts-check

/**
 * @typedef {Object} OperationCounters
 * @property {number} apiRequests
 * @property {number} promptCharacters
 * @property {number} bytesRead
 * @property {number} bytesWritten
 * @property {number} ledgerWrites
 * @property {number} artifactWrites
 * @property {number} uiFullRenders
 * @property {number} uiIncrementalRefreshes
 */

/** @returns {OperationCounters} */
function createOperationCounters() {
  return {
    apiRequests: 0, promptCharacters: 0, bytesRead: 0, bytesWritten: 0,
    ledgerWrites: 0, artifactWrites: 0, uiFullRenders: 0, uiIncrementalRefreshes: 0
  };
}

/**
 * @param {OperationCounters} counters
 * @param {keyof OperationCounters} name
 * @param {number} [amount]
 */
function incrementCounter(counters, name, amount = 1) {
  counters[name] += Number.isFinite(amount) ? amount : 0;
}

/**
 * @typedef {Object} ServiceTestResult
 * @property {boolean} ok
 * @property {string} code
 * @property {string} testedAt
 * @property {number} [status]
 * @property {string} [message]
 */

/**
 * @param {unknown} value
 * @returns {value is ServiceTestResult}
 */
function isServiceTestResult(value) {
  if (!value || typeof value !== 'object') return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  return typeof candidate.ok === 'boolean'
    && typeof candidate.code === 'string'
    && typeof candidate.testedAt === 'string';
}

module.exports = { createOperationCounters, incrementCounter, isServiceTestResult };

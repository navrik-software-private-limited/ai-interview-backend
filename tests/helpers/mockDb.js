// Shared fake for the `mssql` fluent-chain pattern repeated across every
// repository in this repo (getPool() -> pool.request().input(...).query(...)).
// No executeQuery-style helper exists in ai-interview-backend to mock at a
// thinner boundary, so this factory is what avoids re-implementing the
// chain in every test file.
//
// Usage in a test file:
//   jest.mock("../../config/database", () => ({
//     getPool: jest.fn(),
//     closeDatabase: jest.fn(),
//     connectDatabase: jest.fn(),
//     sql: require("../helpers/mockDb").sqlTypesStub,
//   }));
//   const { getPool } = require("../../config/database");
//   const { createMockPool } = require("../helpers/mockDb");
//   const pool = createMockPool();
//   getPool.mockResolvedValue(pool);
//   pool.request().query.mockResolvedValueOnce({ recordset: [{ ... }] });

function createMockRequest() {
  const request = {
    input: jest.fn(() => request),
    query: jest.fn().mockResolvedValue({ recordset: [] }),
  };
  return request;
}

// `pool.request()` always returns the SAME request instance, so a test can
// configure `.query`/`.input` on it before or after calling the code under
// test, and inspect `.mock.calls` afterward. This matches the repo-wide
// pattern of one `pool.request()...query()` chain per repository call.
function createMockPool() {
  const request = createMockRequest();
  const transactionRequest = createMockRequest();
  const transaction = {
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    request: jest.fn(() => transactionRequest),
  };
  return {
    request: jest.fn(() => request),
    transaction: jest.fn(() => transaction),
    _request: request,
    _transaction: transaction,
  };
}

// mssql's type tags (sql.UniqueIdentifier, sql.NVarChar, sql.Int, ...) are
// only ever used as opaque markers passed into `.input(name, type, value)`
// in this codebase's repositories — the fake `.input()` above never inspects
// them. An earlier version of this stub used a catch-all Proxy instead of
// this explicit list, but any Proxy whose `get` trap answers every property
// (including `asymmetricMatch`) gets misidentified by Jest's internal
// equality/matcher machinery as an asymmetric matcher itself, silently
// breaking `expect.anything()`/`toHaveBeenCalledWith` comparisons anywhere
// the stub was passed. An explicit, finite object has no such risk — this is
// the full set of type tags actually used across the repo (confirmed via a
// repo-wide grep for `sql\.[A-Z]\w*`); add to it if a repository starts using
// a new one. `Decimal` is the only one called with args (`sql.Decimal(5,2)`)
// in this codebase, so it alone needs to be a function.
const BARE_SQL_TYPE = "SQL_TYPE_STUB";
const sqlTypesStub = {
  UniqueIdentifier: BARE_SQL_TYPE,
  Int: BARE_SQL_TYPE,
  BigInt: BARE_SQL_TYPE,
  NVarChar: BARE_SQL_TYPE,
  VarChar: BARE_SQL_TYPE,
  DateTime2: BARE_SQL_TYPE,
  Bit: BARE_SQL_TYPE,
  Decimal: () => BARE_SQL_TYPE,
};

module.exports = { createMockRequest, createMockPool, sqlTypesStub };

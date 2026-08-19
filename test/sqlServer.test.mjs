import assert from "node:assert/strict";
import test from "node:test";
import { hasSqlServerConfig, sqlServerConfig } from "../server/config/sqlServerConfig.mjs";
import { getSqlServerPoolWithRetry } from "../server/database/sqlServerPool.mjs";
import {
  inspectSqlServer,
  listSqlServerUserTables,
  SQL_SERVER_2000_HEALTH_QUERY,
  SQL_SERVER_2000_TABLES_QUERY
} from "../server/repositories/sqlServerRepository.mjs";
import {
  findLegacyVehicle,
  findLegacyReferenceByCode,
  findLegacyModelCandidates,
  findLegacyOrganizationCandidates,
  createLegacyVehicleReference,
  buildFuzzyLikePattern,
  CREATE_LEGACY_MODEL_QUERY,
  CREATE_LEGACY_ORGANIZATION_QUERY,
  FIND_LEGACY_MODEL_CANDIDATES_QUERY,
  FIND_LEGACY_MODEL_BY_CODE_QUERY,
  FIND_LEGACY_ORGANIZATION_CANDIDATES_QUERY,
  FIND_LEGACY_ORGANIZATION_BY_CODE_QUERY,
  FIND_LEGACY_VEHICLE_QUERY
} from "../server/repositories/legacyVehicleRepository.mjs";
import {
  getLatestLegacyDispatchNumber,
  MAX_LEGACY_DISPATCH_NUMBER_QUERY
} from "../server/repositories/legacyDispatchNumberRepository.mjs";
import {
  listLegacyDepartments,
  LIST_LEGACY_DEPARTMENTS_QUERY
} from "../server/repositories/legacyDepartmentRepository.mjs";

const validEnv = {
  SQLSERVER_HOST: "192.168.0.244",
  SQLSERVER_PORT: "1433",
  SQLSERVER_DATABASE: "kxqpjxc2",
  SQLSERVER_USER: "app_reader",
  SQLSERVER_PASSWORD: "secret"
};

test("SQL Server config defaults to SQL Server 2000 compatible transport", () => {
  const config = sqlServerConfig(validEnv);
  assert.equal(config.options.encrypt, false);
  assert.equal(config.options.tdsVersion, "7_1");
  assert.equal(config.options.trustServerCertificate, true);
  assert.equal(config.port, 1433);
});

test("SQL Server config requires a complete connection and TDS 7.1", () => {
  assert.equal(hasSqlServerConfig(validEnv), true);
  assert.equal(hasSqlServerConfig({ ...validEnv, SQLSERVER_PASSWORD: "" }), false);
  assert.throws(() => sqlServerConfig({ ...validEnv, SQLSERVER_PORT: "invalid" }), /valid TCP port/);
  assert.throws(() => sqlServerConfig({ ...validEnv, SQLSERVER_TDS_VERSION: "7_4" }), /must be 7_1/);
});

test("SQL Server connection retries once before any query or transaction starts", async () => {
  let attempts = 0;
  const connected = await getSqlServerPoolWithRetry(2, 0, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary tunnel failure");
    return { connected: true };
  });

  assert.equal(attempts, 2);
  assert.deepEqual(connected, { connected: true });
});

test("SQL Server health query and mapping are compatible with SQL Server 2000", async () => {
  assert.match(SQL_SERVER_2000_HEALTH_QUERY, /dbo\.sysobjects/i);
  assert.doesNotMatch(SQL_SERVER_2000_HEALTH_QUERY, /sys\.tables/i);

  const result = await inspectSqlServer(async (query) => {
    assert.equal(query, SQL_SERVER_2000_HEALTH_QUERY);
    return {
      recordset: [{
        server_name: "USER-20230526MU",
        database_name: "kxqpjxc2",
        login_name: "app_reader",
        version: "Microsoft SQL Server 2000",
        table_count: 42
      }]
    };
  });

  assert.deepEqual(result, {
    ok: true,
    serverName: "USER-20230526MU",
    databaseName: "kxqpjxc2",
    loginName: "app_reader",
    version: "Microsoft SQL Server 2000",
    tableCount: 42
  });
});

test("SQL Server table inventory uses SQL Server 2000 catalogs", async () => {
  assert.match(SQL_SERVER_2000_TABLES_QUERY, /dbo\.sysobjects/i);
  assert.match(SQL_SERVER_2000_TABLES_QUERY, /dbo\.sysusers/i);

  const tables = await listSqlServerUserTables(async () => ({
    recordset: [
      { owner_name: "dbo", table_name: "vehicle" },
      { owner_name: "dbo", table_name: "repair_order" }
    ]
  }));

  assert.deepEqual(tables, [
    { owner: "dbo", name: "vehicle" },
    { owner: "dbo", name: "repair_order" }
  ]);
});

test("legacy vehicle lookup uses SQL Server 2000 parameters and maps the public contract", async () => {
  const inputs = [];
  const sqlTypes = {
    VarChar(length) {
      return { type: "VarChar", length };
    }
  };

  const vehicle = await findLegacyVehicle(
    { plate: "辽A12345", vin: "" },
    async (query, configureRequest) => {
      assert.equal(query, FIND_LEGACY_VEHICLE_QUERY);
      assert.match(query, /dbo\.qxclxxb/i);
      assert.match(query, /select top 1/i);
      assert.match(query, /union all/i);
      assert.match(query, /dbo\.khxxb/i);
      configureRequest({
        input(name, type, value) {
          inputs.push({ name, type, value });
        }
      }, sqlTypes);
      return {
        recordset: [{
          id: 12,
          plate: "辽A12345",
          vin: "LSV123",
          model: "测试车型",
          model_code: "CSCX",
          organization_code: "QDDT",
          organization_name: "青岛地铁运营有限公司",
          plate_matched: 1,
          vin_matched: 0
        }]
      };
    }
  );

  assert.deepEqual(inputs, [
    { name: "plate", type: { type: "VarChar", length: 50 }, value: "辽A12345" },
    { name: "vin", type: { type: "VarChar", length: 50 }, value: "" }
  ]);
  assert.deepEqual(vehicle, [{
    id: "12",
    plate: "辽A12345",
    vin: "LSV123",
    model: "测试车型",
    modelLegacyCode: "CSCX",
    organization: { code: "QDDT", name: "青岛地铁运营有限公司" },
    plateMatched: true,
    vinMatched: false
  }]);
});

test("legacy model and organization candidate queries are normalized and parameterized", async () => {
  const inputs = [];
  const sqlTypes = {
    VarChar(length) {
      return { type: "VarChar", length };
    }
  };
  const execute = (rows) => async (query, configureRequest) => {
    configureRequest({
      input(name, type, value) {
        inputs.push({ name, type, value });
      }
    }, sqlTypes);
    return { recordset: rows(query) };
  };

  const models = await findLegacyModelCandidates("AUDIA6", execute((query) => {
    assert.equal(query, FIND_LEGACY_MODEL_CANDIDATES_QUERY);
    assert.match(query, /dbo\.cxb/i);
    assert.match(query, /having count\(vehicle\.reid\) > 0/i);
    return [{ value: "Audi A6", code: "ADA6", usage_count: 8 }];
  }));
  const organizations = await findLegacyOrganizationCandidates("青岛地铁运营有限公司", execute((query) => {
    assert.equal(query, FIND_LEGACY_ORGANIZATION_CANDIDATES_QUERY);
    assert.match(query, /dbo\.khxxb/i);
    assert.match(query, /dbo\.qxclxxb/i);
    assert.match(query, /having count\(vehicle\.reid\) > 0/i);
    return [
      { value: "青岛地铁运营有限公司", code: "QDDT", usage_count: 10 },
      { value: "青岛地铁运营有限公司", code: "QDDT-ERROR", usage_count: 0 }
    ];
  }));

  assert.deepEqual(models, [{ value: "Audi A6", code: "ADA6", usageCount: 8 }]);
  assert.deepEqual(organizations, [{ value: "青岛地铁运营有限公司", code: "QDDT", usageCount: 10 }]);
  assert.deepEqual(inputs, [
    { name: "model", type: { type: "VarChar", length: 200 }, value: "AUDIA6" },
    { name: "model_pattern", type: { type: "VarChar", length: 500 }, value: "%A%U%D%I%A%6%" },
    { name: "organization", type: { type: "VarChar", length: 200 }, value: "青岛地铁运营有限公司" },
    { name: "organization_pattern", type: { type: "VarChar", length: 500 }, value: "%青%岛%地%铁%运%营%有%限%公%司%" }
  ]);
  assert.equal(buildFuzzyLikePattern("水务公司"), "%水%务%公%司%");
});

test("exact reference code lookup includes unused master data and uses legacy field lengths", async () => {
  const inputs = [];
  const execute = async (query, configureRequest) => {
    assert.equal(query, FIND_LEGACY_MODEL_BY_CODE_QUERY);
    assert.doesNotMatch(query, /having count/i);
    configureRequest({ input(name, type, value) { inputs.push({ name, type, value }); } }, {
      VarChar(length) { return { type: "VarChar", length }; }
    });
    return { recordset: [{ code: "DZXPST", value: "大众-新帕萨特", usage_count: 0 }] };
  };

  assert.deepEqual(await findLegacyReferenceByCode("model", "DZXPST", execute), {
    value: "大众-新帕萨特",
    code: "DZXPST",
    usageCount: 0
  });
  assert.deepEqual(inputs, [{ name: "code", type: { type: "VarChar", length: 10 }, value: "DZXPST" }]);
  assert.match(FIND_LEGACY_ORGANIZATION_BY_CODE_QUERY, /dbo\.khxxb/i);
});

test("new vehicle references are inserted with parameters inside a SQL Server transaction", async () => {
  const calls = [];
  const runTransaction = async (work) => work(async (query, configureRequest) => {
    const inputs = [];
    configureRequest({ input(name, type, value) { inputs.push({ name, type, value }); } }, {
      VarChar(length) { return { type: "VarChar", length }; }
    });
    calls.push({ query, inputs });
    return { recordset: [{ code: inputs[0].value, value: inputs[1].value, was_created: 1 }] };
  });

  assert.deepEqual(await createLegacyVehicleReference({
    kind: "model",
    code: "DZXPST",
    name: "大众新帕萨特"
  }, runTransaction), {
    value: "大众新帕萨特",
    code: "DZXPST",
    usageCount: 0,
    created: true
  });
  assert.equal(calls[0].query, CREATE_LEGACY_MODEL_QUERY);
  assert.match(calls[0].query, /insert into dbo\.cxb \(bh, mc, qc\)/i);
  assert.deepEqual(calls[0].inputs, [
    { name: "code", type: { type: "VarChar", length: 10 }, value: "DZXPST" },
    { name: "name", type: { type: "VarChar", length: 200 }, value: "大众新帕萨特" }
  ]);
  assert.match(CREATE_LEGACY_ORGANIZATION_QUERY, /insert into dbo\.khxxb \(bm, mc\)/i);
  assert.match(CREATE_LEGACY_ORGANIZATION_QUERY, /updlock, holdlock/i);
});

test("legacy departments come from SQL Server repair-order departments", async () => {
  const departments = await listLegacyDepartments(async (query) => {
    assert.equal(query, LIST_LEGACY_DEPARTMENTS_QUERY);
    assert.match(query, /dbo\.bmxxb/i);
    assert.match(query, /dbo\.qxwxb/i);
    return {
      recordset: [
        { code: "A", name: "机电一部", is_default: true },
        { code: "M", name: "机电二部", is_default: false }
      ]
    };
  });

  assert.deepEqual(departments, [
    { code: "A", name: "机电一部", isDefault: true },
    { code: "M", name: "机电二部", isDefault: false }
  ]);
});

test("legacy dispatch allocation reads the highest A-prefixed number from SQL Server 2000", async () => {
  const inputs = [];
  const latest = await getLatestLegacyDispatchNumber("a", async (query, configureRequest) => {
    assert.equal(query, MAX_LEGACY_DISPATCH_NUMBER_QUERY);
    assert.match(query, /dbo\.qxwxb/i);
    assert.match(query, /ISNUMERIC/i);
    configureRequest({
      input(name, type, value) {
        inputs.push({ name, type, value });
      }
    }, {
      Char(length) {
        return { type: "Char", length };
      }
    });
    return { recordset: [{ max_number: 66289 }] };
  });

  assert.deepEqual(inputs, [
    { name: "prefix", type: { type: "Char", length: 1 }, value: "A" }
  ]);
  assert.deepEqual(latest, {
    prefix: "A",
    maxNumber: 66289,
    dispatchNo: "A66289"
  });
});

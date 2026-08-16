import { pool } from "../server/database/pool.mjs";

const confirmationFlag = "--confirm-delete-all-work-orders";
const confirmed = process.argv.includes(confirmationFlag);

try {
  const summary = await pool.query(`
    select
      (select count(*)::int from work_orders) as work_orders,
      (select count(*)::int from legacy_sync_outbox) as legacy_sync_events,
      (select count(*)::int from files where order_id is not null) as attached_files
  `);

  if (!confirmed) {
    console.log(JSON.stringify({
      deleted: false,
      message: "未执行删除。确认数量后，使用强制确认参数重新运行。",
      current: summary.rows[0],
      command: `npm run db:clear-work-orders -- ${confirmationFlag}`
    }, null, 2));
    process.exitCode = 1;
  } else {
    await pool.query("begin");
    try {
      const deleted = await pool.query("delete from work_orders returning id");
      await pool.query("commit");
      console.log(JSON.stringify({
        deleted: true,
        deletedWorkOrderCount: deleted.rowCount,
        deletedWorkOrderIds: deleted.rows.map((row) => row.id),
        note: "关联的同步事件、维修项目、签字、OCR 与文件元数据已按外键级联删除；用户、权限配置及磁盘图片文件未删除。"
      }, null, 2));
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
  }
} finally {
  await pool.end();
}

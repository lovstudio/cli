import {
  AccountError,
  currentAccountSession,
  disconnectAccount,
  requireAccountSession,
} from "../../lib/account.mjs";

function printHelp() {
  console.log(`lovstudio account — connect this device to your Lovstudio website account

Usage:
  lovstudio account connect       bind once through lovstudio.ai
  lovstudio account status        show the website account used by local Agents
  lovstudio account disconnect    remove this device session

Website purchases are attached to the same account ID. After this one-time
device confirmation, paid Skills check that account automatically; no license
key or repeated purchase confirmation is required.
`);
}

function accountLabel(session) {
  return session?.email || session?.user_id || "(账号信息不可用)";
}

async function connect() {
  try {
    const session = await requireAccountSession({ clientName: "Lovstudio CLI / Agent" });
    console.log(`✓ 本机已连接 Lovstudio 网站账号：${accountLabel(session)}`);
  } catch (error) {
    const detail = error instanceof AccountError ? error.message : String(error);
    console.error(`连接 Lovstudio 网站账号失败：${detail}`);
    process.exit(1);
  }
}

async function status() {
  try {
    const session = await currentAccountSession();
    if (!session) {
      console.error("本机尚未连接 Lovstudio 网站账号。运行：lovstudio account connect");
      process.exit(1);
    }
    console.log(`已连接：${accountLabel(session)}`);
  } catch (error) {
    const detail = error instanceof AccountError ? error.message : String(error);
    console.error(`网站账号会话已失效：${detail}`);
    console.error("重新连接：lovstudio account connect");
    process.exit(1);
  }
}

async function disconnect() {
  const { remoteError } = await disconnectAccount();
  console.log("✓ 已移除本机 Lovstudio 网站账号会话。");
  if (remoteError) {
    console.error(`提示：网站会话撤销未确认，但本机凭据已删除：${remoteError.message || remoteError}`);
  }
}

export const accountCommand = {
  summary: "connect Agents to your website account",
  async run(args) {
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
      printHelp();
      return;
    }
    const aliases = {
      login: "connect",
      whoami: "status",
      logout: "disconnect",
    };
    const sub = aliases[args[0]] || args[0];
    if (sub === "connect") return connect();
    if (sub === "status") return status();
    if (sub === "disconnect") return disconnect();
    console.error(`unknown account subcommand: ${args[0]}`);
    console.error("run 'lovstudio account --help' for usage");
    process.exit(2);
  },
};

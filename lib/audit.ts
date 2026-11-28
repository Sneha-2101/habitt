import { prisma } from "@/lib/prisma";
import { computeIpPrefix } from "@/lib/sessions";
import { Prisma } from "@prisma/client";

export interface WriteAuditParams {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
}

export async function writeAudit(
  params: WriteAuditParams,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const ipPrefix = params.ip ? computeIpPrefix(params.ip) : undefined;
  const data = {
    actorId: params.actorId || null,
    action: params.action,
    entity: params.entity || null,
    entityId: params.entityId || null,
    meta: params.meta || Prisma.DbNull,
    ipPrefix: ipPrefix || null,
  };

  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }

  try {
    await prisma.auditLog.create({ data });
  } catch (err) {
    console.error("[AuditLog Error]: Failed to write audit log:", err);
  }
}


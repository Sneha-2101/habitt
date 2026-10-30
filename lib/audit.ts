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

export async function writeAudit(params: WriteAuditParams): Promise<void> {
  try {
    const ipPrefix = params.ip ? computeIpPrefix(params.ip) : undefined;
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId || null,
        action: params.action,
        entity: params.entity || null,
        entityId: params.entityId || null,
        meta: params.meta || Prisma.DbNull,
        ipPrefix: ipPrefix || null,
      },
    });
  } catch (err) {
    console.error("[AuditLog Error]: Failed to write audit log:", err);
  }
}


import { createHash, randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";
import { generatePassword, hashPassword, validateEmail, validatePassword, verifyPassword } from "./password.js";

export const SESSION_COOKIE = "zig_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface CreatedUser {
  email: string;
  password: string;
  generated: boolean;
}

export class AppUserStore {
  private readonly prisma: PrismaClient | null;
  private readonly log: Logger;

  constructor(prisma: PrismaClient | null, log: Logger) {
    this.prisma = prisma;
    this.log = log.child({ module: "app-users" });
  }

  async createUser(emailRaw: string, passwordRaw?: string): Promise<CreatedUser> {
    if (!this.prisma) throw new Error("database unavailable");
    const email = validateEmail(emailRaw);
    if (!email) throw new Error("invalid email");

    const generated = !passwordRaw;
    const password = passwordRaw ?? generatePassword();
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);

    await this.prisma.appUser.upsert({
      where: { email },
      create: {
        email,
        passwordHash: await hashPassword(password),
        createdBy: "telegram",
      },
      update: {
        passwordHash: await hashPassword(password),
        isActive: true,
      },
    });

    this.log.info({ email, generated }, "App user created or password reset");
    return { email, password, generated };
  }

  async login(emailRaw: string, password: string): Promise<{ token: string; email: string } | null> {
    if (!this.prisma) throw new Error("database unavailable");
    const email = validateEmail(emailRaw);
    if (!email || password.length === 0 || password.length > 128) return null;

    const user = await this.prisma.appUser.findUnique({ where: { email } });
    if (!user || !user.isActive) return null;
    if (!(await verifyPassword(password, user.passwordHash))) return null;

    const token = randomBytes(32).toString("base64url");
    await this.prisma.appSession.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { token, email: user.email };
  }

  async validateSessionToken(token: string | undefined): Promise<boolean> {
    if (!this.prisma || !token) return false;
    const session = await this.prisma.appSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    return Boolean(session && !session.revokedAt && session.expiresAt.getTime() > Date.now() && session.user.isActive);
  }

  async sessionEmail(token: string | undefined): Promise<string | null> {
    if (!this.prisma || !token) return null;
    const session = await this.prisma.appSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) return null;
    return session.user.email;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!this.prisma || !token) return;
    await this.prisma.appSession.updateMany({
      where: { tokenHash: tokenHash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

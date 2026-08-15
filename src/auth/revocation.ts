const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

class RevocationStore {
  private readonly store = new Map<string, Date>();

  revoke(jti: string, expiresAt: Date): void {
    this.store.set(jti, expiresAt);
  }

  isRevoked(jti: string): boolean {
    return this.store.has(jti);
  }

  private cleanup(): void {
    const now = new Date();
    for (const [jti, expiresAt] of this.store) {
      if (expiresAt <= now) this.store.delete(jti);
    }
  }

  startCleanup(): void {
    setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS).unref();
  }
}

export const revocationStore = new RevocationStore();
revocationStore.startCleanup();

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { upsertOAuthUser, verifyPassword } from "@/lib/db";
import { validateEmail } from "@/lib/validate";

export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const providers: Provider[] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const email = String(raw?.email ?? "");
      const password = String(raw?.password ?? "");
      if (validateEmail(email) || !password) return null;
      const u = await verifyPassword(email, password);
      return u ? { id: u.id, email: u.email, name: u.name, image: u.image ?? undefined } : null;
    },
  }),
];
if (googleEnabled) providers.push(Google({ allowDangerousEmailAccountLinking: true }));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  trustHost: true,
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        if (!profile?.email || profile.email_verified === false) return false;
        const u = await upsertOAuthUser("google", account.providerAccountId, profile.email, String(profile.name ?? ""), (profile.picture as string) ?? null);
        user.id = u.id; // our id, not Google's
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) (session.user as { id?: string }).id = String(token.uid);
      return session;
    },
  },
});

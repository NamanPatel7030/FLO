import { auth } from "@/auth";
import { Aurora } from "@/components/Aurora";
import { Footer } from "@/components/Footer";
import { Landing } from "@/components/Landing";

export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;
  return (
    <>
      <Aurora />
      <Landing signedIn={signedIn} />
      <Footer />
      {/* room for the floating dock */}
      <div aria-hidden className="h-24" />
    </>
  );
}

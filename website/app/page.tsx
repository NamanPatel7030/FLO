import { auth } from "@/auth";
import { Aurora } from "@/components/Aurora";
import { Footer } from "@/components/Footer";
import { Landing } from "@/components/Landing";
import { Nav } from "@/components/Nav";

export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;
  return (
    <>
      <Aurora />
      <Nav signedIn={signedIn} />
      <Landing signedIn={signedIn} />
      <Footer />
    </>
  );
}

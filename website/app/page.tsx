import { auth } from "@/auth";
import { Aurora } from "@/components/Aurora";
import { DictationTrail } from "@/components/DictationTrail";
import { Footer } from "@/components/Footer";
import { Landing } from "@/components/Landing";
import { Nav } from "@/components/Nav";
import { NotchSpine } from "@/components/NotchSpine";
import { SectionRail } from "@/components/SectionRail";

export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;
  return (
    <>
      <Aurora />
      <DictationTrail />
      <NotchSpine />
      <SectionRail />
      <Nav signedIn={signedIn} />
      <Landing signedIn={signedIn} />
      <Footer />
    </>
  );
}

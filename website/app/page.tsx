import { Aurora } from "@/components/Aurora";
import { Footer } from "@/components/Footer";
import { Landing } from "@/components/Landing";
import { getUser } from "@/lib/supabase/server";

export default async function Home() {
  const signedIn = !!(await getUser());
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

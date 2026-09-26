import { Nav } from "@/components/nav";
import { Agents } from "@/components/sections/agents";
import { Cta, Footer } from "@/components/sections/cta";
import { Footprint } from "@/components/sections/footprint";
import { Hero } from "@/components/sections/hero";
import { Mobile } from "@/components/sections/mobile";
import { OpenSource } from "@/components/sections/open-source";
import { Parallel } from "@/components/sections/parallel";
import { Together } from "@/components/sections/together";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Agents />
        <Parallel />
        <Together />
        <Mobile />
        <Footprint />
        <OpenSource />
        <Cta />
      </main>
      <Footer />
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, MapPin, Check, ArrowRight, ArrowLeft, Sparkles, Boxes, Clapperboard, ScanLine, PencilRuler } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FloatingField } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCreateProject } from "@/hooks";

const schema = z.object({
  name: z.string().min(2, "Give your project a name"),
  building_type: z.enum(["apartment", "villa"]),
  location: z.string().optional(),
  builder: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const STAGES = [
  { label: "Details", icon: PencilRuler }, { label: "Building", icon: Building2 },
  { label: "Upload", icon: ScanLine }, { label: "AI", icon: Sparkles },
  { label: "3D", icon: Boxes }, { label: "Video", icon: Clapperboard },
];

export function NewProjectWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [step, setStep] = useState(0);
  const router = useRouter();
  const create = useCreateProject();
  const { register, handleSubmit, watch, setValue, trigger, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema), defaultValues: { building_type: "apartment" },
  });
  const type = watch("building_type");

  const next = async () => { if (await trigger(["name"])) setStep(1); };
  const onSubmit = handleSubmit(async (v) => {
    try {
      const { id } = await create.mutateAsync(v);
      toast.success("Project created", { description: v.name });
      onOpenChange(false); setStep(0);
      router.push(`/projects/${id}`);
    } catch (e) { toast.error("Could not create project", { description: (e as Error).message }); }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setStep(0); }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <div className="grid md:grid-cols-[220px_1fr]">
          {/* stepper rail */}
          <div className="hidden flex-col gap-1 border-r border-border bg-surface-2/60 p-5 md:flex">
            <div className="mb-4 text-sm font-semibold">New project</div>
            {STAGES.map((s, i) => (
              <div key={s.label} className={cn("flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm", i === step ? "bg-surface font-semibold shadow-xs" : "text-muted-foreground")}>
                <span className={cn("grid size-6 place-items-center rounded-full text-xs", i < step ? "bg-success text-white" : i === step ? "bg-primary text-white" : "bg-secondary text-muted-foreground")}>
                  {i < step ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                </span>
                {s.label}
              </div>
            ))}
            <p className="mt-auto pt-4 text-xs text-muted-foreground">Upload, AI analysis, 3D &amp; video continue in the project workspace.</p>
          </div>

          {/* step content */}
          <form onSubmit={onSubmit} className="flex min-h-[420px] flex-col p-6">
            <AnimatePresence mode="wait">
              {step === 0 ? (
                <motion.div key="s0" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }} className="flex-1 space-y-5">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">Project details</h2>
                    <p className="text-sm text-muted-foreground">Name your project and pick a building type.</p>
                  </div>
                  <div>
                    <FloatingField label="Project name" id="np-name" {...register("name")} />
                    {errors.name && <p className="mt-1.5 text-xs text-danger">{errors.name.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(["apartment", "villa"] as const).map((t) => (
                      <button type="button" key={t} onClick={() => setValue("building_type", t)}
                        className={cn("flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all", type === t ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40")}>
                        <span className="text-2xl">{t === "villa" ? "🏡" : "🏢"}</span>
                        <span className="text-sm font-semibold capitalize">{t}</span>
                        <span className="text-xs text-muted-foreground">{t === "villa" ? "Standalone home / bungalow" : "Multi-unit building"}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="s1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }} className="flex-1 space-y-5">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">Building &amp; location</h2>
                    <p className="text-sm text-muted-foreground">Optional context — you can edit this later.</p>
                  </div>
                  <FloatingField label="Location / city" id="np-loc" {...register("location")} />
                  <FloatingField label="Builder / developer" id="np-builder" {...register("builder")} />
                  <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 p-4">
                    <MapPin className="mt-0.5 size-4 text-primary" />
                    <p className="text-xs text-muted-foreground">After creating, upload a floor plan and run AI analysis to detect rooms, walls, doors &amp; windows automatically.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
              {step === 1 ? (
                <Button type="button" variant="ghost" onClick={() => setStep(0)}><ArrowLeft /> Back</Button>
              ) : <span />}
              {step === 0 ? (
                <Button type="button" onClick={next}>Continue <ArrowRight /></Button>
              ) : (
                <Button type="submit" loading={create.isPending}>Create project <Check /></Button>
              )}
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

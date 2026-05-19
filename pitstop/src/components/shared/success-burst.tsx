import { motion } from "framer-motion";
import { Check } from "lucide-react";

/** Brief confetti-style success overlay after auto-approve */
export function SuccessBurst({ show }: { show: boolean }) {
  if (!show) return null;

  const particles = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-pitstop-go shadow-lg shadow-emerald-500/40"
      >
        <Check className="h-10 w-10 text-slate-950" strokeWidth={3} />
      </motion.div>
      {particles.map((i) => (
        <motion.span
          key={i}
          className="absolute h-2 w-2 rounded-full bg-pitstop-go"
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{
            x: Math.cos((i / 12) * Math.PI * 2) * 120,
            y: Math.sin((i / 12) * Math.PI * 2) * 120,
            opacity: 0,
          }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronRight, ChevronLeft, Heart, Shield, Users, TrendingUp } from "lucide-react";
import welcomeImg1 from "@/assets/welcome-slide-1-v2.png";
import welcomeImg2 from "@/assets/welcome-slide-2-v2.png";
import welcomeImg3 from "@/assets/welcome-slide-3-v2.png";
import welcomeImg4 from "@/assets/welcome-slide-4-v2.png";
import welcomeImg5 from "@/assets/welcome-slide-5-v2.png";

const WELCOME_KEY_PREFIX = "tf_welcome_shown_";

interface SlideData {
  image: string;
  title: string;
  content: React.ReactNode;
}

const VALUE_ITEMS = [
  { icon: Heart, label: "Service", desc: "We help each other grow" },
  { icon: Shield, label: "Responsibility", desc: "We show up and take care" },
  { icon: Users, label: "Community", desc: "We build real friendships" },
  { icon: TrendingUp, label: "Growth", desc: "Mistakes are how we learn" },
];

const slides: SlideData[] = [
  {
    image: welcomeImg1,
    title: "Welcome to Tech Fleet! 🎉",
    content: (
      <p className="text-sm text-muted-foreground leading-relaxed">
        A nonprofit where people learn to work well on teams. Whether you're starting out, switching paths, or already experienced — <span className="font-medium text-foreground">you belong here.</span>
      </p>
    ),
  },
  {
    image: welcomeImg2,
    title: "What We Stand For",
    content: (
      <div className="grid grid-cols-2 gap-3">
        {VALUE_ITEMS.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/40 p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
              <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    image: welcomeImg3,
    title: "How It Works",
    content: (
      <p className="text-sm text-muted-foreground leading-relaxed">
        We pair <span className="font-medium text-foreground">nonprofits</span> that need work done with <span className="font-medium text-foreground">people like you</span> who want real team experience. Along the way you'll practice service leadership, agile teamwork, and shared decision-making.
      </p>
    ),
  },
  {
    image: welcomeImg4,
    title: "What You Can Do",
    content: (
      <div className="space-y-2.5">
        {[
          { emoji: "🛠️", name: "Project Training", desc: "Real projects for nonprofits — no experience needed" },
          { emoji: "📚", name: "Learning Labs", desc: "Hands-on classes with certificates" },
          { emoji: "🤝", name: "Community", desc: "Events, group projects, and peer support" },
        ].map((item) => (
          <div key={item.name} className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
            <span className="text-base leading-none mt-0.5">{item.emoji}</span>
            <div>
              <p className="text-sm font-medium text-foreground leading-tight">{item.name}</p>
              <p className="text-xs text-muted-foreground leading-snug">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    image: welcomeImg5,
    title: "5 Steps to Get Going",
    content: (
      <ol className="space-y-1.5 text-sm text-muted-foreground">
        {[
          "Connect to Discord",
          "Complete your onboarding",
          "Learn about Agile",
          "Join Project Training",
          "Join Volunteer Teams",
        ].map((step, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span className="leading-snug">{step}</span>
          </li>
        ))}
      </ol>
    ),
  },
];

export function WelcomeDialog() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (!user) return;
    const key = WELCOME_KEY_PREFIX + user.id;
    if (!localStorage.getItem(key)) setOpen(true);
  }, [user]);

  const handleClose = () => {
    if (!user) return;
    localStorage.setItem(WELCOME_KEY_PREFIX + user.id, "true");
    setOpen(false);
    setCurrentSlide(0);
  };

  const slide = slides[currentSlide];
  const isLast = currentSlide === slides.length - 1;
  const isFirst = currentSlide === 0;
  const progress = ((currentSlide + 1) / slides.length) * 100;

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) handleClose(); }}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0 rounded-2xl"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-desc"
      >
        {/* Progress bar */}
        <Progress value={progress} className="h-1 rounded-none rounded-t-2xl" />

        {/* Image area */}
        <div className="flex justify-center px-6 pt-5 pb-2">
          <img
            src={slide.image}
            alt=""
            className="h-28 w-28 object-contain"
            aria-hidden="true"
          />
        </div>

        {/* Content area */}
        <div className="px-6 pb-2">
          <DialogHeader className="items-center text-center mb-3">
            <DialogTitle id="welcome-title" className="text-lg font-semibold">{slide.title}</DialogTitle>
            <DialogDescription id="welcome-desc" className="sr-only">
              Welcome information about Tech Fleet
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-[120px] flex items-start">{slide.content}</div>
        </div>

        {/* Step indicator dots */}
        <div className="flex justify-center gap-1.5 px-6" role="tablist" aria-label="Slide indicators">
          {slides.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === currentSlide}
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentSlide ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/25"
              }`}
              onClick={() => setCurrentSlide(i)}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex gap-2 px-6 pt-3 pb-2">
          {!isFirst && (
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setCurrentSlide((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {isLast ? (
            <Button size="sm" className="flex-1" onClick={handleClose}>
              Let's Go! <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" className="flex-1" onClick={() => setCurrentSlide((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

        {!isLast && (
          <button
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto pb-4"
          >
            Skip introduction
          </button>
        )}
        {isLast && <div className="pb-4" />}
      </DialogContent>
    </Dialog>
  );
}

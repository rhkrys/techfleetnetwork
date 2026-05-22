import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Globe, Clock, MessageCircle, Check, ChevronsUpDown, AlertCircle, Link as LinkIcon, Bell, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { COUNTRIES } from "@/lib/countries";
import { TIMEZONES } from "@/lib/timezones";
import { EDUCATION_OPTIONS } from "@/lib/application-options";
import { ExperienceAreasSelect } from "@/components/ExperienceAreasSelect";
import { ACTIVITY_OPTIONS } from "@/lib/validators/profile";
import { Separator } from "@/components/ui/separator";
import type { AppFormData } from "@/lib/validators/general-application";

const educationOptions: MultiSelectOption[] = EDUCATION_OPTIONS.map((e) => ({ value: e, label: e }));

interface Props {
  form: AppFormData;
  errors: Record<string, string>;
  updateField: <K extends keyof AppFormData>(key: K, value: AppFormData[K]) => void;
}

/** Section 2: Profile Review — location, discord, experience, education, goals, interests, preferences */
export function SectionProfile({ form, errors, updateField }: Props) {
  const [countryOpen, setCountryOpen] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);

  const toggleInterest = (interest: string) => {
    const next = form.interests.includes(interest)
      ? form.interests.filter((i) => i !== interest)
      : [...form.interests, interest];
    updateField("interests", next);
  };

  return (
    <div className="space-y-6">
      {/* Location */}
      <div className="space-y-1.5">
        <Label>Location <span className="text-destructive">*</span></Label>
        <Popover open={countryOpen} onOpenChange={setCountryOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={countryOpen}
              className={cn("w-full justify-between pl-10 relative font-normal", !form.country && "text-muted-foreground")}
              aria-invalid={!!errors.country}
            >
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {form.country || "Search or select a country..."}
              <Search className="ml-auto h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a country name to search..." autoFocus />
              <CommandList>
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup>
                  {COUNTRIES.map((c) => (
                    <CommandItem key={c.code} value={c.name} onSelect={() => { updateField("country", c.name); setCountryOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", form.country === c.name ? "opacity-100" : "opacity-0")} />
                      {c.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {errors.country && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><AlertCircle className="h-3 w-3" /> {errors.country}</p>}
      </div>

      {/* Timezone */}
      <div className="space-y-1.5">
        <Label>Timezone <span className="text-destructive">*</span></Label>
        <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={timezoneOpen}
              className={cn("w-full justify-between pl-10 relative font-normal", !form.timezone && "text-muted-foreground")}
              aria-invalid={!!errors.timezone}
            >
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {form.timezone ? TIMEZONES.find((tz) => tz.value === form.timezone)?.label || form.timezone : "Search or select a timezone..."}
              <Search className="ml-auto h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a city or region to search (e.g. New York, GMT)..." autoFocus />
              <CommandList>
                <CommandEmpty>No timezone found.</CommandEmpty>
                <CommandGroup>
                  {TIMEZONES.map((tz) => (
                    <CommandItem key={tz.value} value={tz.label} onSelect={() => { updateField("timezone", tz.value); setTimezoneOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", form.timezone === tz.value ? "opacity-100" : "opacity-0")} />
                      {tz.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {errors.timezone && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><AlertCircle className="h-3 w-3" /> {errors.timezone}</p>}
      </div>

      {/* Discord Connection — shared verified flow (identical UX everywhere) */}
      <ProfileDiscordConnector />

      <Separator />

      {/* Experience */}
      <div className="space-y-1.5">
        <Label>Experience Areas <span className="text-destructive">*</span></Label>
        <ExperienceAreasSelect
          selected={form.experience_areas}
          onChange={(v) => updateField("experience_areas", v)}
          aria-invalid={!!errors.experience_areas}
        />
        {errors.experience_areas && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><AlertCircle className="h-3 w-3" /> {errors.experience_areas}</p>}
      </div>

      {/* Education */}
      <div className="space-y-1.5">
        <Label>Education Background <span className="text-destructive">*</span></Label>
        <MultiSelect
          options={educationOptions}
          selected={form.education_background}
          onChange={(v) => updateField("education_background", v)}
          placeholder="Select education background"
        />
        {errors.education_background && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><AlertCircle className="h-3 w-3" /> {errors.education_background}</p>}
      </div>

      {/* Professional Goals */}
      <div className="space-y-1.5">
        <Label htmlFor="app-goals" className="text-base font-semibold leading-relaxed">
          Professional Goals <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="app-goals"
          value={form.professional_goals}
          onChange={(e) => updateField("professional_goals", e.target.value)}
          className="min-h-[120px] resize-y"
          maxLength={5000}
          aria-invalid={!!errors.professional_goals}
          aria-describedby="app-goals-count"
        />
        <p id="app-goals-count" className="text-xs text-muted-foreground text-right">{form.professional_goals.length} / 5,000</p>
        {errors.professional_goals && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><AlertCircle className="h-3 w-3" /> {errors.professional_goals}</p>}
      </div>

      {/* Scheduling URL */}
      <div className="space-y-1.5">
        <Label htmlFor="app-scheduling-url">Scheduling Link</Label>
        <p className="text-xs text-muted-foreground">Share your scheduling link (e.g., Calendly) for interview coordination</p>
        <div className="relative">
          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id="app-scheduling-url"
            value={form.scheduling_url}
            onChange={(e) => updateField("scheduling_url", e.target.value)}
            placeholder="https://calendly.com/your-link"
            className="pl-10"
            maxLength={500}
          />
        </div>
      </div>

      <Separator />

      {/* Activity Interests */}
      <div className="space-y-3">
        <Label>Activity Interests</Label>
        <p className="text-xs text-muted-foreground">What kinds of activities do you want to do in Tech Fleet?</p>
        {ACTIVITY_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggleInterest(option)}
            className={cn(
              "w-full text-left p-3 rounded-lg border transition-all flex items-center gap-3",
              form.interests.includes(option)
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            )}
          >
            <div
              className={cn(
                "h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center",
                form.interests.includes(option)
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-primary"
              )}
              aria-hidden="true"
            >
              {form.interests.includes(option) && (
                <Check className="h-3 w-3" />
              )}
            </div>
            <span className="text-sm">{option}</span>
          </button>
        ))}
      </div>

      <Separator />

      {/* Notification Preferences */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <Label className="text-base font-semibold">Notification Preferences</Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="app-notify-training"
            checked={form.notify_training_opportunities}
            onCheckedChange={(checked) => updateField("notify_training_opportunities", !!checked)}
          />
          <Label htmlFor="app-notify-training" className="text-sm leading-relaxed cursor-pointer">
            I'd like to receive notifications about new training opportunities
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="app-notify-announcements"
            checked={form.notify_announcements}
            onCheckedChange={(checked) => updateField("notify_announcements", !!checked)}
          />
          <Label htmlFor="app-notify-announcements" className="text-sm leading-relaxed cursor-pointer">
            I'd like to receive email notifications about announcements
          </Label>
        </div>
      </div>
    </div>
  );
}

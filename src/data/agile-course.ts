import type { CourseLesson, CourseSection } from "@/data/project-training-course";

export type AgileLesson = CourseLesson;
export type AgileCourseSection = CourseSection;

export const AGILE_COURSE_SECTIONS: AgileCourseSection[] = [
  {
    title: "Introduction",
    lessons: [
      {
        id: "agile-intro-1",
        title: "What You Read About Agile May Be Different From What You See in the World",
        youtubeId: "iOHQRwqSvyE",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/start-the-agile-handbook-here/what-you-read-about-agile-may-be-different-from-what-you-see-in-the-world",
        content: `**This Handbook Describes the Possibilities**

In Tech Fleet training, we train service leadership: how teammates bring themselves to teams to be in service to others. We train psychological safety: how teammates can provide encouragement for others to be themselves, speak out, and take healthy team risks. We train self-organization: how teams can be given the authority to collectively decide how to proceed themselves.

We train continuous improvement: How teams can help each other remove their fear of failure, and look at failure as opportunities to grow and change.

Tech Fleet project training teams mature in Agile philosophies as they were described.

This is not always the reality we find in the world. You may have experienced a completely different way of life on teams.

You may have worked with managers who are authoritarian, or hands-off.

You may have worked with team mates who acted in competition with you, and did not practice service leadership.

You may have operated on teams where you did not feel psychologically safe to speak out, or fail, or bring your personality to the team work.

We deal with these adversities everywhere in the work world.

Teams may call themselves Agile, but do nothing to practice its philosophies. Leaders may operate based on fear, instead of growth, and prevent teams from taking healthy risks or try to control outcomes. Teams may not have foundations of psychological safety, and they may be afraid to speak up about things that can change. They may be agile in name only, and practice Waterfall philosophies.

This is our reality. While you are training, you learn the ideal state. When you proceed in the world you have a choice to lead by example. You have a choice to inspire change in others. You have a choice in how you contribute to team culture. You can only control your behaviors and actions and intentions.

**You Have the Power**

You have the power to be the change that you want to see in the world. It only takes one person's realization that there are better ways of working to inspire change. It may not happen on a timeline that suits your needs, but change can happen.

By practicing the Agile philosophies and the traits of strong Agile team work, you can change the world, one person, one team, at a time.

You have a choice:

1. You can choose to lead by example.
2. You can choose to set healthy boundaries and share the perspective of psychological safety.
3. You can choose to lead in service of others' growth, even in situations where someone's not being a service leader to you or to others.
4. You can choose to inspire teams and managers to transfer their authority to a collective team voice, and build self-organization.

You won't always have a perfect outcome on teams. But that's not what's important. What is important is your self-care, and your continuous improvement. Learning. Progress. Growth. Lessons in how to approach adversity on teams and in the world.

**Tech Fleet Members Are the Change**

We are pioneers in Agile.

Tech Fleet members can bring this change to teams in the world to help them mature in Agile practices as they should be. We can help teams reach their potential through more psychological safety, more service leadership, and more self-organization.

We encourage you to live this. Take it seriously. Read this handbook and practice these principles in Tech Fleet training. Learn how to live these words of Agile Manifesto. You will bring so much added value to teams in the world when you can bring a mindset of team growth and learning over the work outcomes. Through this, we will all be the change that the tech world needs.

Go through the Agile Handbook to learn about the different ways that strong Agile teams prioritize growth over work outcomes, and how to live your best Agile life. You, too, can be the change on teams.`,
      },
      {
        id: "agile-intro-2",
        title: "Introduction to the Agile Handbook",
        youtubeId: "GMZRdXYCqzw",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/start-the-agile-handbook-here/introduction-to-the-agile-handbook",
        content: `**Get Ready for Your World To Change**

**In school you are taught to produce a perfect result.** You do it in phases. You take your time. You deal with minor constraints. You may work without clients.

To "succeed" in industry environments you have to re-learn and un-learn the ways you have been trained in your education.

Agencies and in-house company teams in the industry operate in completely different ways:

1. Their processes are non-linear.
2. They do UX and development work in parallel.
3. They collaborate across different functions.
4. They don't gather all of the requirements up front.
5. They change plans as they work.
6. They operate in uncertainty.
7. They ship products iteratively.

**Changing Your Mindset**

**You have to develop an Agile mindset to succeed in the industry.**

When you learn Agile, your ways of working will change.

As a UX researcher, UX designer, product person, project management person, or developer, you will be expected to change the way you work.

Your mindset will shift in how you should be bringing yourself to teams.

Your perspective will grow and change over time.

Companies may expect employees to already have experience working in Agile. You will likely be asked to speak to your Agile philosophies when interviewing.

It's crucial to build your Agile mindset in UX, product, and development fields.

Tech Fleet can help. We are an Agile Coaching organization, and all of the community work embeds Agile in its day-to-day processes.

**TL;DR: What's Agile? Why Should I Care?**

**Agile is a philosophy and a way of approaching UX work.**

**Agile teams deliver incremental value as they go.**

They do not work in sequential order or phases. They deliver small chunks of usable, valuable functionality to users continuously instead of delivering the full result all at once.

Waterfall teams (AKA the way you have probably been trained) build nothing but the car they agreed to in the beginning. They build the parts in sequential order. They put the entire car together before they deliver to users or clients. No one sees anything being built until it's launched. No one validates their direction while they are building.

Agile teams take the opposite approach. Instead of building a car in parts, Agile teams build usable things they can test along the way. They deliver value to users in chunks that increasingly solves more problems.

**Incremental Value with Agile**

Agile delivers value throughout a project, while Waterfall delivers value at the end of a project.

Agile, as such, is less risky than Waterfall. Agile teams verify their direction as they deliver value and change if they need to.

The Agile releases in the "Car" example solve incremental problems and bring incremental value:

1. A skateboard meets basic needs of transportation.
2. A scooter is more valuable than the skateboard because it offers more stability while traveling.
3. A bike is more valuable than the scooter because it lets you travel further and more efficiently.
4. A motorcycle is more valuable than the bike because it goes fast, travels far, and is safer.
5. A car is more valuable than the motorcycle because it is safer, fast, holds more travelers, and offers more cargo space.

If, and only if, the Agile team has validated that these results bring incremental value, they will start building towards the next release.

If they learned after delivering something that it doesn't deliver needs, they change their plans.

These are two very different ways of performing work.

Agile teams, because they deliver incremental value, deliver stronger results in the end.

**This Handbook Teaches a Foundational Agile Mindset**

**Welcome to the "Fail Fast" life.** This is the new and improved Agile Handbook for Tech Fleet.

This handbook offers introduction to the Agile ways of work. It covers:

1. Agile philosophies
2. Traits of strong Agile teams
3. Living daily Agile life
4. Deliverables for Agile team success

Tech Fleet is an Agile coaching organization and all teams are expected to operate in Agile ways of work.

All Tech Fleet members should read this handbook to prepare for the Agile mindset before they apply to project training.`,
      },
      {
        id: "agile-intro-3",
        title: "Can AI Replace Agile Teams?",
        youtubeId: "Ou0_QSuZwso",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/start-the-agile-handbook-here/can-ai-replace-agile-teams",
        content: `**Increasing Use of Artificial Intelligence in Tech**

In 2025 we see the advent of artificial intelligence in everything that we do. And in the tech industry that's no different. Artificial intelligence tools are popping up as a way to streamline work, to cut time in meetings, to cut down the process of delivery, to make life easier for everybody involved across all functions.

**Will AI Replace Agile Teams?**

What does that mean for the implications of teams that are working in an Agile fashion?

Does that mean that our jobs are going to go away? Does that mean that cross functional teamwork will go away?

Artificial intelligence is a tool. Artificial intelligence is a way to use something to carry out results of what you're trying to do. Artificial intelligence can help you define how something can get done, or what to recommend for goals.

But artificial intelligence can't collaborate. It can't decide what problems to focus on. It can't lead people. It can't make a critical thinking-based judgment. It can't team build. It can't decide when to pivot. Artificial intelligence is only as strong as what it's prompted and programmed to do. It's only as strong as its data and its data sets.

AI can never replace Agile cross-functional team work, but it can make it stronger.

**Agile is Human-Oriented**

Agile is a philosophy and a way of thinking. And it's very centered around people.

Agile is not about the work, or the results. Agile is about how you treat others in your collaboration as a teammate. Agile is about how you prioritize delivery to users and clients.

Strong agile teams provide space for people to grow, to learn, to fail, to experiment.

Agile teamwork is about a way of life that you adopt in order to respect each other, to grow, to collaborate, to communicate, to use AI as tools.

What works for the team is not defined by anything but the team itself. What works for the team is defined by the team on a continuous basis.

The philosophy of agile will never go away in the age of AI. The processes of agile that get built are lived by, you guessed it, humans.

Before they start doing their work, they have to define why they're here, what they're moving toward. They have to define how they want to work together. They need to define who does what function each time they go out and do work.

None of that could be defined by artificial intelligence. All of that can be streamlined by artificial intelligence. Agile will never be replaced. Because Agile is not a tool.

Because of this, AI is going to continue being used as a tool, but it will never replace the human oriented work of an Agile team.

**How to Use AI for Agile Work**

Here are some ways that Agile teams can use artificial intelligence to streamline their work.

1. They can use AI to produce quicker results by using AI to get work done.
2. They can use AI to plan how they're going to use AI as a tool.
3. They can use AI to check their work.
4. They can use AI to research the market.
5. They can use AI to compile research results.
6. They can use AI to research user needs that have been researched before.
7. They can use AI to create interfaces as decided based on requirements.
8. They can use AI to understand how to best communicate.
9. They can use AI to identify best practices they could potentially adopt.

And more. Through all of this, they still need to work together as humans, support each other as humans, grow as humans, experiment and fail as humans, and deliver value as humans.`,
      },
    ],
  },
  {
    title: "Agile Philosophies",
    lessons: [
      {
        id: "agile-phil-1",
        title: "Waterfall Ways of Work",
        youtubeId: "M7Eo7YTu08Q",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-philosophies/waterfall-ways-of-work",
        content: `**What's Waterfall?**

First, we're going to learn about what's Waterfall. The way that you're learning in school is called waterfall.

Waterfall is a phased approach of work.

1. Requirements
2. Research
3. Design
4. Develop
5. Test
6. Release

**Example of Waterfall**

Let's say that you're hired by a company to make a scooter. You have a year and a half to make that scooter.

And so you plan the whole thing. You make a plan all at the beginning. You're going to do your requirements where you gather all the information that you need up front, and then you do all your research, and then you do all your design, you design the whole thing, and then you go into the development phase, and you develop the whole thing, and then you do your test phase and you test the whole thing.

Everything is sequential in Waterfall. Everything happens before the next. There's no design happening in the development phase, there's no research happening in the design phase.

It's all in steps.

So that's what you do for your scooter. You go out in the world, and you go and talk to people. And, of course, they want everything under the sun. They want a GPS, and they want a backup camera, and they want a cat chariot. They want to carry their cat around because who doesn't want to carry their cat into the world?

They want it all. You write it all down. You write down artificial intelligence, and driving up to 90 miles an hour. And having a touch screen, having that cat chariot and the three seater.

And you've got your requirements phase done and you move on to the next.

And now you're in the design phase and you design everything that it would ever be. You design the cat chariot and the AI and the GPS and everything that the scooter is ever going to be, you're going to spend three months doing the whole thing all at once. And then it gets into development and the developers build it in chunks.

And they spend a whole year building it. So they're going to build the wheels, then they build the body, then they build the motor. Then they build the cat chariot, and then they put it all together, and it goes into the testing phase a year and three months in. And they're done the test, and it's ready to launch.

You spend a year and a half building this, and you hit market.

Behold! Ye Olde Cat Chariot!

All of a sudden you realize that nobody wants it. The market's changed. This person told you that they wanted a GPS, and they wanted a cat chariot at the time, but then their life changed. The circumstances around them changed. Now they have a smartphone, they don't need a GPS anymore, and their cat ran away.

They just ended up buying a bike six months ago. Meanwhile, your team worked 18 months and didn't talk to anybody while they did it. They didn't talk to any users, they didn't validate anything, they just worked behind the scenes, phase to phase to phase to phase, and delivered 18 months later. They just spend all that time and money delivering a scooter that nobody wants.

You may have been on projects before where this has happened to you. You work for so long on a thing that's so complicated and hard, and you develop the perfect result, and you do it, you deliver it, and it may not even get used. And this is how people are trained.

You might be thinking to yourself, This is fine. This is how it is. What happened on the next team project? Did you do the same thing?

There is a better way of working UX. There are better ways and more effective ways to deliver value to whomever in the world.

**The Rules of Waterfall**

1. You do everything in phases
2. You do your research and then you do your requirements And then you do your design and then you do your development And then you do your testing
3. Clients and users don't say anything until the end if you mess up or you learn something new
4. You don't change anything because in theory, the product requirements are already set in waterfall.
5. You don't change anything or incorporate feedback until you're finished the project. With Waterfall, you're going to deliver what you agreed to.

**Typical Waterfall Deliverables**

1. Product Requirements document
2. Work contracts
3. Research reports
4. Full design specifications`,
      },
      {
        id: "agile-phil-2",
        title: "Agile Ways of Work",
        youtubeId: "X6bjIIVaWVI",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-philosophies/agile-ways-of-work",
        content: `**Agile is a Way of Life**

Agile is a philosophy. It is a way that you carry yourself. It is not a bunch of meetings. It is not a bunch of processes or tools. It's not JIRA.

Agile is a mindset that you put into your head, that you approach a different way to deliver value to users and to customers.

And every time you implement Agile, it changes the way it carries out, changes, evolves. It is different every single time. Every team you join that's Agile has a different way of doing things. That's on purpose because of what we follow called the Agile Manifesto.

**The Rules of Agile**

These are the things that we live by as Agile UX practitioners.

**We are uncovering better ways of developing software by doing it and helping others do it.**

Through this work, we have come to value:

1. **Individuals and interactions over processes and tools.** What does that mean? It means that you should never come up with a perfect process. You should talk it out with your team and figure out how you should go with your team.

2. **Delivering working software over comprehensive documentation.** What does that mean? It means that you should deliver things into the hands of users early and often. And you should spend your energy doing that. Getting it shipped. Getting the research results done. Getting the design done. Getting the evaluation of it. Versus documenting how it works.

3. **Collaborating with customers over making contracts.** What does that mean? You shouldn't make a product requirements document. You should not be agreeing to everything all at once and then delivering what you agree to. You should set high level goals and high level priorities and then interact with individuals to figure out how that should change over time. Everything is in a state of flux on your team because everything in the world is in a state of flux. So you should never be building something that is steadfast and already agreed to. You should be figuring out what you think you're moving toward and then figuring out how can you validate that quickly and early and often to then figure out what your direction needs to be.

4. **Responding to change over following a plan.** When the world changes, when your plan has to change, you change the plan. When you're no longer doing research, You got to respond to the change when your research priority changes, you got to respond to the change. When you are in need of making a whole new set of deliverables, you got to respond to the change.

Notice how these are not very concrete. These are not very succinct. They're not telling you exactly how to do it exactly what meetings to do exactly what ways you need to work with researchers and developers and project managers. Because this is a philosophy. This is a way of life. You will live these four tenets.

Everything you do is going to be interacting with individuals, delivering working UX results, collaborating with customers, and responding to change.

That's all that Agile is. All the things that you add to Agile, like sprints, and scrum, and retros, and all that stuff, those are the ways of carrying out Agile. These are methodologies of Agile. Agile itself is a mindset. It's a way of life.`,
      },
      {
        id: "agile-phil-3",
        title: "Applying Agile Philosophies to Work",
        youtubeId: "MPpy7kAuxCU",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-philosophies/applying-agile-philosophies-to-work",
        content: `**Agile is an Adjective, Not a Noun**

You're either agile or you're not agile. And you can be agile anything. You could be an agile developer. You can be an agile researcher. You can be an agile car builder. You can be an agile accountant. You can be an agile vacation taker. You can do chores with Agile. Literally anything can apply to the Agile manifesto.

When you're working with a team, your team's going to exist on a spectrum, a scale. How much does your team apply the Agile principles? Spoiler alert, it's never going to be 100%. It could be 0%. You could be waterfall as anything. You could be a mix. You could be operating with a mix of waterfall principles and Agile principles.

Over time, your team's agility, notice the adjective there, your team's agility is going to evolve the way that you all carry out the Agile manifesto, the way that you carry yourselves in your philosophy of your approach, the ways that you interact with individuals, the ways that you build working UX, the ways that you respond to change, that's going to change over time. That's why every single team that gets together is different. The way that you all agree how you're going to work together is actually defined by you.

Everybody comes into the field looking for specific answers.

1. What do I do?
2. When do I do this?
3. How do I do it?
4. What should I not do?

There is no one answer to that. There's no right way of doing that. There's only the way that you, the team, agree to do it. That's what makes Agile complicated.

It's not going to be a concrete answer because Agile team work is an agreement that you make across roles across your team.

**Agile Practice**

Some of the principles of Agile, the things that you'll say when you carry out this work:

1. Progress over process.
2. Deliver early and often.
3. Build fast, fail fast.
4. Let the team experiment with new ways of work.
5. You don't need all the requirements up front, you just need the most important ones up front.
6. Do what makes sense in the context of your team.
7. Show your progress.
8. Pivot.

**Build Fast, Fail Fast**

Number one rule is to build fast fail fast, which means that you're not just failing. If you're just failing, you're just a giant mess. If you're not improving what you've done, based on the lessons that you've learned in failing, You're never going to progress. So in Agile, what you do is you build fast, which means get it into the hands of users quickly. And you learn that you're not headed in the right direction quickly, failing fast.

And then you change your plan quickly. Learn fast, adjust fast. The key word there is fast. Not fail, but fast. You have to build fast, fail fast. In the context of research, that means that you have to deliver research fast and learn that you're headed in the right direction or not headed in the right direction fast.

**Don't Talk About it Endlessly: Just Do It**

Number two, don't talk about it endlessly. Just start doing it. You don't need to come up with a perfect process. You don't need to perfect it and talk about all the what ifs, what ifs, what ifs. Just start doing it. Start collaborating with your teammates, collaborating with customers, collaborating with users, and figure it out.

**Do What Makes Sense in the Context of Your Team**

Do what makes sense in the context of your team. If some theory is telling you, you have to do this, but the team context prevents you from doing that, You're not going to be able to fit that thing into the context of your team very well. You can't force the thing that you learn in a book on a team.

You have to be able to build malleability and flexibility around how you apply that thing to the team.

**Always Work on the Highest Priority**

You always need to work on the most important thing, the riskiest assumptions, the highest priority items at any given time. If you're not doing that, and you're delivering the things that are nice to have, you're not really delivering a lot of value because you're moving toward things that are nice to have, but you're not vetting the most important things at any given time.

If you do that, that will also lead to adjustments and pivots a lot more, but it will lead to a stronger product in the end. And you always want to deliver something usable after one iteration. An iteration is just a chunk of work. You will deliver research in one week.

You will deliver designs that are validated in one week. One week's time. What you're used to in training is you have the whole semester. You have six months. You have two months. Not the case.

**Constantly Deliver Usable Results**

You always want to make sure that the thing that you build in the end isn't just a chunk. Isn't just a part of it, but it's something that you can put into the hands of users, validate, test, determine the direction of quickly.

What this means for UX teams: you are delivering smaller rounds of research and design every week or every couple of weeks. You're not producing the entire finished result at once: you are delivering it in usable chunks that you can validate and provide prioritized value.

Learn how Agile teams build products into the world with Agile in the next lesson.`,
      },
      {
        id: "agile-phil-4",
        title: "Building MVPs and MMPs with Agile",
        youtubeId: "5N3OqDBCMDo",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-philosophies/building-mvps-and-mmps-with-agile",
        content: `**Agile Product Development**

If someone comes to you and says, I want to build a scooter, you have to determine what that long term end result looks like in the end, vaguely. The thing that you're trying to make money with and put into the market is called the **Minimum Marketable Product (MMP).**

Then you work your way backwards and you say, what is the first thing that we should be doing that helps us validate the direction and is the most valuable thing that we could deliver first? The first release, and the incremental releases after that, are called **Minimum Viable Product (MVP).**

The way that agile product development works is you start with a cycle, working your way past the MMP to the MVP.

1. Define your long-term vision (MMP)
2. Define the first release (MVP #1)
3. Deliver the first release quickly
4. Gather feedback
5. Review the vision and adjust plans
6. Start building the next MVP release and repeat the cycle
7. Build as many MVP's as you need to before you launch at market

**MVP: Minimum Viable Products**

At every point, you should be determining the bare minimum to deliver, the MVP that you should be working toward.

MVP is just a concept, but it's an important concept to know whether you're doing UX work or discovery work or development work.

The MVP itself is a concept that constitutes something that is simple, valuable, actionable, and testable.

The MVP is something that is very simple. Something that is valuable, usable, and testable.

**MVP Build Cycle**

You build and validate the MVP quickly. You deliver it. You adjust your plans, and you go back to the drawing board, back to step number one, and say how does that change my long term vision? Let's do another one, and then you build another MVP, and then another MVP, and then another MVP, and you just keep going through that until maybe one day you release the thing to market.

Maybe you never release it to market. The process that you're going to learn, whether it be through research or design or strategy or chores or vacationing or accounting work, is how to scope a plan in the beginning, determine the highest priority for that, deliver that thing quickly, analyze it, and adjust.

You iterate, you release it, you evaluate, you plan that thing for the next release based on your priorities at the time, and then you keep going. Meanwhile, the thing that you're trying to build may change, and you have to go back into what you were working toward to then change it.

**MVP Requirements**

And when you're gathering requirements, you don't do it all at once. If you're building an MVP, you have to talk about what it must have. So, sorry, cat. Can't take a cat chariot around in the first MVP because that's not the most important priority. I apologize, cat. I know that that's disappointing for you, and that's really hard to hear.

But what the scooter must have is that it must drive in the city. Can't go off road. It must be able to drive a reasonable speed. It must have one person seating. Because it needs to meet the basic needs of getting around and then once we have delivered that thing we've delivered the must have through one to many iterations.

**Responding to Change**

We evaluate that thing as we build and after we deliver. We plan the next release. And what that release looks like, we start it over again. Over time, what you're doing is you're building more value to users. You're not delivering all the value only at the end, like in Waterfall. So by the time you hit market, you've got a really strongly validated and really usable, really refined experience.

**Building the Scooter with MVP's**

Here's how you would build that motor scooter with a cat chariot through Agile. Each time you do it, you build something usable and valuable and minimal. So to meet the basic needs, I'll build a skateboard. It'll take me three months out of the 18 months, but I'll get something quickly out the door that helps me validate the direction, and then I'll say, okay.

That validates the direction. Let's keep going. What is the next basic need that we can meet that kind of adds to the previous one? Well, we can add more stability. We can build a scooter with a handle. Not motorized. It just goes fast enough to get around, but it offers a little bit more stability and it meets a little bit more needs.

And then you work on the fast things. And only if you have validated the direction of those MVPs, you know you're headed in the right direction with the MMP, and you start building the MMP. Notice how it takes 18 months still. But the things that we build in the first two MVPs are something completely different than what the end result should be, because they focus on basic problems that we're trying to solve.

What happens if your requirements change? What happens if you build that skateboard and you determine, okay, everybody just got a smartphone because the smartphone came out.

So we don't need a cat chariot scooter with a GPS. We need a bike. Oh, all right. That's cool. Pivot, change your direction, change your vision, change your scope, respond to the change.`,
      },
    ],
  },
  {
    title: "Agile Teamwork",
    lessons: [
      {
        id: "agile-team-1",
        title: "Prioritizing Growth Over Skills",
        youtubeId: "MDI_GFTK6qY",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/prioritizing-growth-over-skills",
        content: `**It's Not About The Team's Skills or Experience**

You may have a perception in your head that if only you had more experience and more skills, you can join teams and immediately start producing work.

You may think that expert Agile teams in the world are very experienced in what they do.

This is a false perception.

Expert Agile teams are experts in navigating uncertainty, experts in pivoting, and experts in supporting growth of others.

They are not necessarily experts in technical and interpersonal skills. They progress through product development by being of service to each other as they manage risks and build a working process together.

Yes, we're all here to make a living. We're all here trying to deliver results. We want to ship products. We want to have job security. We've got to make management happy if we want to stay working at a company.

But Agile teamwork is not really about producing work itself.

Any one person with skills and experience can perform work.

To work as a unified Agile team, teams must look past the skills and tight deadlines. They must look past seeking perfect outcomes.

They must provide environments for experimentation, risk taking, learning, and personal growth.

**Agile Teams Help Each Other Grow**

Teams that are Agile have the following foundations of active listening, empathy, understanding, learning, and support.

They make their own calls about how to prioritize work. Agile teams don't try to control outcomes or prevent failure. They play out scenarios and respond to change.

They collaborate and build working results quickly so that they can learn how to change their plans. The team decides how to work, and when to prioritize, and what to deliver. This requires a whole lot of foundational Agile culture and mindsets.

Expert Agile teams provide the space for others to disagree and hear people out. They support each other in failing "fast" together, adjusting their work, and looking in reflection. They never judge or blame each other.

The more a team provides these, the more a team produces strong end-results. The faster they will ship their product. The stronger that product will become at market.

**Earning Work Efficiency**

Everyone on an Agile team intentionally acts in support of growth. They:

1. Make each team member (even the interns) feel like an essential piece.
2. Seek to understand others, instead of seeking to be understood.
3. Help each other set goals and mark progress.
4. Allow space for people to try things for the first time.
5. Prioritize the growth of others around them.
6. Praise, celebrate, and acknowledge each other.
7. Encourage teammates to experiment with new ways of work.
8. Provide conditions for people to be themselves and be vulnerable.

Through this, they will grow together. They will gain skills and experience. They will ship very strong products. They will meet the needs of clients. They will be satisfied in their work.`,
      },
      {
        id: "agile-team-2",
        title: "The Four Stages of Team Growth",
        youtubeId: "5Vs5PFCL7mw",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/the-four-stages-of-team-growth",
        content: `**Teams Earn Progress through Conflict Resolution**

Most people think teams that work well together start immediately working well together. But it's not possible to do so without resolving conflict. After all, it's not about their skill levels.

Teammates have different experiences and different perspectives. Teammates have different ways of working and different lessons learned from the past. When they get together, those past experiences and perspectives may clash. This is the natural progression through the team growth process.

Teams must provide room for respect and growth before being able to produce work efficiently together. They must hear each other, and acknowledge each other. They can't be in competition with each other.

**There are Four Stages of Teamwork**

The moment a team gets together, they go through "stages of being".

Academic professionals theorized that there are four stages of every team's development. Every single team in the world goes through four stages of team work.

1. Forming
2. Storming
3. Norming
4. Performing

It's only when they start performing that they work well, efficiently deliver, produce more work, and are happy in their work.

**The Forming Stage**

During the Forming stage, the team first gets together, and doesn't have a common way of working established yet, but they meet each other.

Tasks: A team kickoff, ice breakers, expectation setting.

Feelings: Excitement, belonging, cheer, positivity, confidence, nervousness, anxiety.

Behaviors: Being polite with each other, questions from team members, acting excitedly, uncertainty about the future, anxiety about their place on the team.

**The Storming Stage**

During the Storming stage, the team starts figuring out how they should be working together, and this happens through talking out disagreements.

Tasks: Defining short-term action items based on goals, starting work, deciding how to work together.

Feelings: Anxiety about whether the team can do what they are set out to do, anger about the lack of progress, frustration about the lack of progress.

Behaviors: Arguing about how to work together and about decisions, conflict and discussing differences of opinion, discussing how to start in the work and the goals of the work, criticizing team mates' decisions, questioning the future of the team.

**The Norming Stage**

During the Norming phase, team members resolve their differences, and align in how to work together. They start making agreements in how they should produce the work in collaboration and proceed in the work.

Tasks: Agreeing to work process, discussing and building consensus, collective teamwork, focusing on aligning goals.

Feelings: Confidence, inclusion, comfort.

Behaviors: Building consensus with team mates, constructive criticism, harmoniously working together, being willing to hear people and work together, celebrating team mates for what they bring to the table.

**The Performing Stage**

During the Performing phase, members work efficiently together, and are satisfied in their work together. They work well, and are more aligned than ever in the work.

Tasks: Aligning on goals, planning long-term work, deepening knowledge, increasing skills, increasing accomplishments.

Feelings: Satisfaction in the work, "Can Do" attitude, increased confidence, empowerment, happiness.

Behaviors: Getting more work done, more flexibility in the work, team mates take on multiple roles of responsibility, team members feel empowered, appreciation for work and for others.

**Storming is Essential**

Without Storming, a team wouldn't be able to progress to performing. They need to build agreement with each other, and hear each other. They need to build a consensus about how they will work together and what they decide to work on. Teams should embrace storming as a natural part of team building.

Most importantly, they need to respect diverse perspectives and people. They need to help each other grow. They need to fail forward together. They need to unify.

In order to get over the Storming stage, Agile teams must bring the following fundamentals to their group:

1. Psychological Safety
2. Service Leadership
3. Self-Organization
4. Continuous Improvement

When they do, they will move past Storming and progress toward Norming and Performing. They will start iteratively delivering value like the best Agile teams out there.`,
      },
      {
        id: "agile-team-3",
        title: "Building Agile Mindsets",
        youtubeId: "_9yjJJKrrDs",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/self-actualized-agile-teams/building-agile-mindsets",
        content: `**Agile Team Strength is Continuously Maintained**

Team strength is not measured in how much work they can get done. In Agile environments it's measured in agility. Teams should build strong foundations of celebrating team mates, supporting growth, taking risks, and experimenting with new ways of working to successfully deliver strong results.

Agility changes over time, and it doesn't happen all at once. This is because it requires a huge mindset shift for teammates.

The philosophies of Agile must be constantly maintained, just like a garden must be watered and upkept.

Team members check in with others and everyone acts in support of everyone's growth.

What does someone's level of agility depend on? 5 things! Read more below.

**Foundations of Strong Agile Teams**

Everyone on an Agile team leads in service to others: the interns, the junior contributors, the managers, and the executives.

At its core, all Agile teams who are strongly performing have the following principles built among the team within their culture:

1. Psychological Safety
2. Service Leadership
3. Self-Organization
4. Continuous Improvement
5. Iterative Value Delivery

There is a Pyramid of Agile Tenets that makes self-actualized Agile teams.

This picture shows the hierarchy of Agile team needs and what must be in place before teams can Perform.

Without a foundation of psychological safety and service leadership, teams cannot become strong Agile teams. They will Storm longer. They may storm forever, and never get to Performing. They won't get as much work done either!`,
      },
    ],
  },
  {
    title: "The Team Practices",
    lessons: [
      {
        id: "agile-prac-1",
        title: "Psychological Safety",
        youtubeId: "E_d01Me8GgU",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/self-actualized-agile-teams/psychological-safety",
        content: `**Where We Are in the Agile Pyramid**

We are all the way at the bottom of the Agile pyramid for strong teams. Psychological safety is the first thing that must be built in order to build self-actualized Agile teams.

**Psychological Safety**

Psychological Safety is the core foundation on all Agile teams.

**Psychological safety is a shared understanding that team members will not reject or punish people for speaking out, taking risks, or failing.**

Psychological safety is a required pre-requisite for Agile work. Without it, Agile teams cannot become fully Agile. Agile teams who have a shared mission, responsible collectively, require psychological safety in order for collaboration to happen. It provides space for people on teams to take risks that are healthy for team progress. With it, they can organize themselves and grow.

If teams can't speak out about things that need to be improved, how can they respond to change? How can they collaborate? How can they produce working results?

**Psychological Safety Factors**

**Psychological Safety includes Trust**

Team mates must trust each other to proceed in their work. Trust is earned as teams understand each other and feel comfortable with each other.

Trust happens in many ways. Teams must trust that activities will play out. Teams must trust that even when work fails, the team will progress together. Teams must trust that teammates have each others' backs.

Team mates should not be reprimanded for taking risks or speaking dissent about things that move a team forward. There must be a shared understanding that teams can fail safely knowing they will progress and adjust.

**Psychological Safety includes Empathy**

Teams should be built with many diverse perspectives and backgrounds. To build psychological safety, each person needs to understand perspectives and people. They need to acknowledge each other, share an understanding, and listen to what they are saying before responding.

Teams that build empathy with each other produce strong psychological safety to be themselves around the team. This is important for empowering teams.

**Psychological Safety includes Respect**

In addition to trust and empathy, team mates need to respect each other in their work. Respect shows itself in providing room for people to own work, or asking others' opinions before deciding.

Teams who have strong psychological safety discuss and convene to build consensus after listening to each person's perspective who wants to be involved in the conversation.

**Psychological Safety includes Inclusion**

Team mates need to feel a strong sense of ownership, and value on their team.

Dynamics of power should be shifted and distributed such that each teammate is included in decision making. Each teammate should be included in ownership of work, and have choices of how they get involved.

Each teammate should feel the power of belonging, and feel their work has meaning. Teams should provide inclusive environments for personalities and perspectives to build a strong psychological safety.

**Psychological Safety includes Openness**

People need to provide space for team mates to be vulnerable and open with each other. Conflict can only be resolved when people know about it, and can speak about it constructively. Disagreements and dissenting opinions should be encouraged when they help a team progress in their work and when teams can talk it out constructively.

They must always respect and empathize with each other through their open conversations. Teammates should be open with each other and candidly discuss items that bring out growth in teamwork, even when they are uncomfortable to discuss.

Every person on the team has a role to play in providing room for open discussions and open perspectives.

**Psychological Safety includes Risk Taking and Failure**

Strong teams not only allow work failure, they embrace failure as part of their culture. They provide room for people to take risks if it will progress the team in their work.

By giving each other room to try new things, to experiment, they will produce stronger work together and build stronger trust with each other.

**Psychological Safety Checklist**

Here's a way you can check to ensure that psychological safety is strong on your team:

1. Make every member of the team feel like they have room to speak their mind.
2. Actively listen when others have things to say, and make team feel like their voice matters.
3. Give people the room for people to bring their own personalities and unique capabilities to the table in the way THEY want to do so.
4. Allow room for team mates to challenge the status quo, and experiment with new ways of working.
5. Encourage failing "fast", i.e. failure and quick reflection and quick adjustment based on what the team thinks they should do.
6. Let people take the risks that THEY decide to take, that could lead to failure or disaster, for the purposes of allowing them to build up decision making prowess.

**How to Build Psychological Safety**

When teams feel a lack of psychological safety, they may be afraid to speak up, and they may lose their motivation to work. They may become more distant or absent in the team. They may think there's no point in bringing feedback up. These are signs that psychological safety may be lacking on the team. When psychological safety is lacking, the team will storm.

This could be due to many things. You as a teammate should work to understand what's going on in the team dynamics before concluding how to resolve it. Teams must work together to identify issues with open conversation and respect toward each other.

Every team member plays a role in success here. Leaders, managers, or team peers may contribute to a lack of psychological safety equally.

To uncover opportunities to build psychological safety, it may be best to proceed with one-on-one conversations, or discuss things in sprint retrospectives constructively. It's important to build empathy and respect for individuals so that they're heard in these discussions. You can only build a psychologically safe team together, united, as one team. Everyone needs to be bought into psychological safety.`,
      },
      {
        id: "agile-prac-2",
        title: "Service Leadership",
        youtubeId: "jqWtW7NyAk0",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/self-actualized-agile-teams/service-leadership",
        content: `**Where We Are in the Agile Pyramid**

We're on the second tier of the Agile self-actualization pyramid!

**Service Leadership**

**In Agile, Service Leadership is the style of leadership all Agile teams build.**

**In Tech Fleet, we call this "Service Leadership" as all teammates are leaders in service to others' growth.**

Teams who are psychologically safe can be there for each other as service leaders.

In this style, each individual on a team focuses on developing and mentoring others, providing guidance and support to help them grow and improve.

A manager provides direction, and allows teams to decide how they carry out the outcomes.

The managers empower employees to take ownership of their work.

Peers are service leaders to other peers. Managers are service leaders to employees. Employees are service leaders to managers.

Everyone is a service leader to everyone else on an Agile team. It's a web of support, growth, and service.

**Acting as a Service Leader**

All team mates should act as service leaders to each other, those around them, those "above" them, or those "below" them in any organization's hierarchy.

There is no leadership hierarchy in this style of leadership because power is transferred to everyone on the team. Peers lead themselves and others together.

Everyone plays a role in everyone else's success on an Agile team. You don't need to be an expert to be a leader. You are a leader in service to others' growth. You are celebrating your peers' growth. You are contributing to psychological safety with peers. You are celebrating risk-taking and growth. Everyone works together in service to each other.

**Yes, that means you! Even the apprentices, even the interns, even the observers, are service leaders on Agile teams! NOT just the co-leads!**

Here's how this plays out daily on teams:

1. Service leaders shift their authority to teams, and allow teams to build consensus about how they carry out the outcomes.
2. You're not telling people what to do or giving them the answer, or preventing them from failing.
3. You are a guide, empowering people to find the answer on their own.
4. You celebrate others doing things for the first time, and you may do first-time tasks with them.
5. You empower them to step outside of their comfort zone and take ownership.
6. You never take control or take over for someone.
7. You ask how they want to be served in their growth.

**Service Leadership on Modern Agile Teams**

A person named Robert Greenleaf made this term in the 1970's with his essay, The Servant As Leader.

In the story, a man acts as a servant to a group, doing work for them. One day the person disappears, and the team falls apart. It was then found that the servant was actually the head of an organization, a powerful leader.

Yet, he was a team's source of inspiration and in service to them. Usually, teams are in service to their managers and leaders.

And so, the concept of service leadership was born (originally called "Servant Leadership" in Greenleaf's writing), and the concept of authoritarian leadership was met with a new way of leading. Leading with the heart.

That was over 50 years ago. Today the world has changed along with modern Agile team environments, and service leadership evolves with it.

Service leaders on Agile teams do not take the work for others, like in the story described by Greenleaf. They empower others to own work and find meaning in the work. People in service to others on Agile teams should do work alongside people and teach them how to lead, producing other leaders and a web of accountability.

When someone on the team leaves, the team should not fall apart because everyone has full ownership on modern Agile teams. Teams should be empowered to decide how to proceed together while being of service to each other. Everyone has ideas that need to be heard. Everyone has decision-making abilities to make judgment calls. Especially the apprentices and interns!

It takes all people of all backgrounds, identities, and ethnicities to produce strong, diverse Agile teams. Seek to build teams with as many different perspectives, backgrounds, and identities for the strongest teamwork possible. This means no one kind of person should be the dedicated person "in charge".

**Service Leadership Checklist**

1. Do your team members support each others' growth over of their own?
2. Does the person in charge tell everyone what to do, or do they transfer the power to the team?
3. Does your team show respect towards others?
4. Does your team empathize with others and help each other?
5. Does your team seek to understand situations that arise, and communicate needs?
6. Does your team set expectations with each other in healthy ways?

**Comparing the Different Styles of Leadership**

There are different ways to lead in this world. Agile teams rely on service leadership to thrive, but you may see teams carry out different styles of leadership.

**Authoritarian Leadership** — In an authoritarian leadership team, there is one person telling everyone what to do. They have all of the vision. They have all of the answers. They make all of the decisions. Those around them carry out their orders. They are not supposed to question the authority of the person in charge.

**Laissez-Faire Leadership** — This style is characterized by a hands-off approach, where the leader gives employees a lot of autonomy and freedom to make decisions. The leader is not involved in the decision-making process, and employees are expected to take ownership of their work.

**Democratic Leadership** — In this style, the leader involves employees in the decision-making process and values their input and opinions. The leader encourages collaboration and open communication, and decisions are made through a consensus-building approach.`,
      },
      {
        id: "agile-prac-3",
        title: "Self-Organization",
        youtubeId: "PLRHGENreC4",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/self-actualized-agile-teams/self-organization",
        content: `**Where We Are in the Agile Pyramid**

We're progressing in the Agile self-actualization pyramid! Teams who are psychologically safe service leaders can start self-organizing and making their own ways of work.

**Self-Organization**

With psychological safety in place, and service leadership in place, teams can start self-organizing.

Self-organization is the principle that allows the day-to-day people doing the work to make decisions themselves.

The boss on the team does not tell them what to do. The managers and executives provide autonomy, and let the team carry out their own work in the way they want, or think is best. After all, they are the ones doing the work! They are the closest to the work and know what's the best thing for the team based on consensus. They know what's best for their process.

All Tech Fleet training teams practice self-organization in their work with clients. No one is an "expert" telling them answers, or preventing them from failing. They carry out work as service leaders to each other.

A team of psychologically safe service leaders can start organizing themselves in the way they think is best. They can go very far in their teamwork through self-organization.

The stakeholders and clients outside of the team may determine priorities and needs, but the team itself is the engine that decides how to carry it out. They decide when they should recommend changing the plan. They decide how they are going to work together to achieve goals. No book or boss or class should tell them exactly how they do it. They need to build a consensus together. They need to organize themselves.

**What about the interns? What about the juniors?**

They should not sit around waiting for someone to tell them what to do. They should not be told. They should be given the decision making power. The power should be transferred to the people doing the work including juniors and interns. Together, through a collective team consensus, they all share their voice and decide things together. Self-organized teams build leaders out of everyone on the team because everyone is in service to everyone else's growth.

**Self-Organization Checklist**

1. Does your team give the juniors and interns a voice as much as the leads and seniors?
2. Does your team wait for answers or initiate things on their own?
3. Does your team ask for clarity before starting or continuing work?
4. Does your team volunteer to work assignments?
5. Does your team contribute to conversations?
6. Does your team present new ideas for how to work, or idea for the product?
7. Does your team build consensus together and involve each other in decision making?`,
      },
      {
        id: "agile-prac-4",
        title: "Continuous Improvement",
        youtubeId: "fA9sm68xyz8",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/self-actualized-agile-teams/continuous-improvement",
        content: `**Where We Are in the Agile Pyramid**

We're far along in the Agile self-actualization pyramid! Teams who are psychologically safe service leaders who are self-organized in their work can start continuously improving their work.

**Continuous Improvement**

Agile teams fail often. They do not look at failure in judgement, but celebration. Failure could mean that their plan didn't follow through. It could mean that a teammate didn't do something they said, or they tried and it didn't work out. Failure could mean that someone didn't show up.

Everything that "fails" on an Agile team is looked at as learning opportunities. Teams intentionally build small value in their releases so that they can deliver quickly and "fail fast", or learn from the delivery.

Teams who are continuously improving use retrospectives and reflection moments to listen and learn from feedback received.

Teams who are continuously improving aren't perfectionists, and they don't treat their teammates as perfectionists. They experiment with something that may not work, and deliver quickly to get feedback quickly. They iterate by making adjustments based on feedback received.

In order to do this, there must be a strong foundation of psychological safety, service leadership in teammates, and self-organization among leadership. These three tenets enable teams to continuously progress, continuously learn from mistakes, continuously improve.

**Continuous Improvement Checklist**

1. Does your team deliver work incrementally in small chunks?
2. Does your team often reflect on previous work and identify areas of improvement?
3. Does your team celebrate failure as progress and learning opportunities?
4. Does your team constantly involve clients, stakeholders, and users in feedback sessions?
5. Does your team work on the most important things at any given time, and deliver them quickly?`,
      },
      {
        id: "agile-prac-5",
        title: "Iterative Value Delivery",
        youtubeId: "eFRl0F6PQ9c",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/making-strong-agile-teams/self-actualized-agile-teams/iterative-value-delivery",
        content: `**Where We Are in the Agile Pyramid**

We made it to the top of the Agile self-actualization pyramid!

**Delivering Value In Chunks**

Teams who are psychologically safe service leaders acting self-organized in their work can continuously improve and deliver iterative value to the world.

They provide space for experimentation and learning.

They give a voice to all team members and provide room for full ownership all around.

They transfer the power to those in the room who are less experienced so that there are more learning opportunities.

They are always looking for opportunities to fail fast and improve their work.

When Agile teams build their self-actualization pyramid, they can truly Perform.

They must do it together. No one single person is responsible for an Agile team's success. No one is "in charge", making all decisions for others. It requires the consensus of many diverse perspectives of people in service to each others' growth.

Value comes when they solve problems for users and for clients. Nothing is ever finished, only progressed. As teams build they get feedback. As they deliver they get feedback. They adjust their plans and respond to change. They collaborate with each other and build working results.

Over time, the value they deliver in the world builds on itself.

They may never get to the MMP because they need to pivot. But whatever happens, their progression is the most valuable thing for the product or service they are building. They are able to validate the risks and produce user-centered value through Agile conventions of work.

In the next lesson, learn what it's like in daily work on self-actualized Agile teams.`,
      },
    ],
  },
  {
    title: "Cross-Functional Team Dynamics",
    lessons: [
      {
        id: "agile-cross-1",
        title: "Cross-Functional Agile Teamwork",
        youtubeId: "VvUi6MJNeTU",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/day-to-day-on-an-agile-team/cross-functional-agile-teamwork",
        content: `**Waterfall is the Opposite of Cross-Functional Agile Teamwork**

Waterfall teams dedicate people to specific functions. In a traditional waterfall team, each person has a dedicated duty that they do all the time.

The designer designs. The coder codes. The researcher researches. They all rely on each other to do their specific function.

When one person leaves, everyone else waits. The specified duty must be filled. Work stops.

When the researcher is busy, the rest of the team waits for them to finish. Work stops.

That's not efficient at all.

When they don't involve others in their work, they create what's called a "work silo". Someone who is dedicated to a role does the work alone, and only for what they were hired for. Waterfall teams are made up of "work silos".

**Cross-Functional Agile Teams are More Flexible**

We need to work together to achieve shared outcomes. We need different perspectives to make decisions. We need to share knowledge and information across teams for them to succeed. Cross-functional teamwork achieves this.

"Cross-functional" Agile teams are teams that contribute across functions together.

They have diverse backgrounds and perspectives. They pitch into each other's work, and they aren't working in one single function. Perspectives are shared across all functions when performing duties. Everyone can contribute to responsibilities across functions whenever they want to.

Cross-functional team members contribute toward a "shared outcome". The entire team, and all of its functions, equally pitch in to get the outcome achieved. When designers volunteer to code, and researchers volunteer to design, and designers volunteer to research, this is celebrated.

**Agile Teams are Like a Heist Crew**

A cross-functional Agile team is assembled for the "perfect heist". They have no titles. They do not stick to one duty. They will only achieve success by working with each other collaboratively.

They all have different backgrounds. They each bring their own unique capabilities. They collaborate with each other in work across different skill sets and functions. They volunteer in the moments that work is needed to achieve the outcome.

Each teammate pitches in to collaborate on work that the other teammates are doing all the time. Diverse perspectives are heard in the work. The more diverse perspectives are heard, the stronger the outcomes. Everyone is a valuable member of the Agile Heist Team.

Each week, the duties change because the team asks who wants to own work whenever they prioritize tasks. People agree to the responsibilities they play in the moments that work needs to be prioritized. They self-organize and agree together who's going to be involved, and how.

You've got the psychological safety to take risks, and you've got service leaders around you helping you grow while doing work that you may have never done before. You and the team self-organize to agree to who will pitch into work. The team prioritizes opportunities for people to continuously improve and try things for the first time.

**Carrying Out Agile Cross-Functional Teamwork**

Here are some things you will hear on strongly performing Agile cross-functional teams:

If there's strong psychological safety:
**"I'm a developer, but I want to participate in user testing this sprint with the designers and researchers."**

If there's strong service leadership:
**"How do you want to be supported in the work? How do you want to get involved in other team roles?"**

If there's strong self-organization:
**"All teams can vote together on what tasks we're going to take on this iteration"**

If there's strong continuous improvement:
**"Let's get with the research team to discuss how this design task went and discuss how to change the way we collaborate in the future"**

If there's strong iterative value delivery:
**"We're going to have a usable feature to test with users by the end of the week".**

**Agreeing to Daily Responsibilities**

All of this may sound confusing to you if you've never experienced it. Why not stick to your job duties? Work silos are good for expectation setting, right?

If your job title is one thing, and you are supposed to work cross-functionally, does that mean you are not doing things in your job title?

No!

Everyone makes their own decision about what they want to contribute to on the team as part of the heist team. No person tells other people what to work on. Teammates assign themselves work based on the team goals and their interests.

If teammates want to stick to a particular function, they'd still collaborate with other kinds of work. Others will rely on their perspective.

During meetings like Sprint Planning in the Scrum Method, teams get together to agree to the shared outcome with Sprint Goals. The Scrum Master helps teammates assign themselves work based on goals. They all self-commit to who's responsible, who's accountable, who's consulted, and who's informed in the work.

No one else tells them what to do, or assigns them work.

They must self-commit. If they commit to work in their own function, great! If they self-commit to work outside of their function, they should be supported!

This is when the team cross-functionally spans across different roles if they want to do so.

The important distinction is this: the team has the capabilities to span across any function while performing work, and they may need to do so in their daily cross-functional work together.

Someone might get sick. Someone might leave the team. Someone might be busy with other things.

That's ok! You have a cross-functional team! No one is siloed. The important thing is for the team to not wait. They are a psychologically safe, self-organized team, and the people who are not in those functions can also do all kinds of other work if they are in a supported environment.

**Deliverables for Cross-Functional Work**

Agile teams maintain a deliverable called a RACI chart (which stands for "Responsible, Accountable, Consulted, Informed") to map out a team's desired functional activities based on the needed tasks.

The chart will change every week because the heist team contributes to different work every week. Team members maintain the details. No one dictates this. The team gets together to agree and build consensus about who does what tasks. This deliverable helps cross-functional teams set expectations across the team.`,
      },
      {
        id: "agile-cross-2",
        title: "Leadership on Agile Teams",
        youtubeId: "Bccz4aSuUpQ",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/day-to-day-on-an-agile-team/leadership-on-agile-teams",
        content: `**TL;DR - There is no leadership hierarchy on Agile Teams!**

The strongest functioning Agile teams in the world transfer ownership and accountability to everyone on the team because they're all service leaders to each other. As such, there should be no person who tells the team what to do and how to work.

**On Tech Fleet project training teams, there is no boss. There is no manager. "co-leads" and "apprentices" are equal to each other. There is only the team of people doing work together.**

Co-leads guide in service leadership and take ownership. Apprentices guide in service leadership and take full ownership.

Everyone has a voice because of psychological safety. Everyone has decision making power because of self-organization. Everyone grows because of continuous improvement.

**On a self-organized Agile team, everyone is in charge! The voice of many decides the outcomes together.**

**The Difference between Co-Leads and Apprentices in Tech Fleet**

We know what you're thinking: if there is no leadership hierarchy, why are the co-leads called "leads"? Aren't they "in charge"?

No! If they were in charge, they would be practicing authoritarian leadership. We must practice service leadership on Agile teams. And we must build self-organized teams. Apprentices are as "in charge" as co-leads. Co-leads are the guides who may pave the way for empowered teams.

They may take on coaching roles while they themselves take on work. They should always take opportunities to make the apprentices feel the full ownership of work and give them a stake. They should always transfer the power to the collective team consensus.

Co-leads and apprentices are equals to each other. They are peers. We have co-leads so that we have people helping to set expectations in the work. Soon after projects start, co-leads should be transferring the power to apprentices so that they can lead and own work.

This is so important to be able to do on a strong performing Agile team. It's crucial for a self-organized team to all feel the same kind of ownership as equals. After all, we're all peers learning together, none of us are experts, even later in life when we have a lot of experience.

To take this approach is to let go of one's ego and tell yourself, "those around me also have great ideas, let's decide together".

**Who Makes Decisions on an Agile Team?**

The team is organized by themselves for themselves. They are all in service to each other. As such, strong Agile teams ask for the consensus. This is why there's a lot of voting on Agile teams. Consensus and discussion from the voice of the team is crucial to finding the team's way forward. No one should provide the answer or tell them what the answer is. They need to build a working relationship together where they decide together in unison.`,
      },
      {
        id: "agile-cross-3",
        title: "Daily Life on Agile Teams",
        youtubeId: "RjqUTMCPRLg",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/day-to-day-on-an-agile-team/daily-life-on-agile-teams",
        content: `**Cross-Functional Agile Team Structure**

How are Agile Teams Structured? It depends!

The team who is cross-functional in their nature brings many backgrounds and perspectives. They get together and build a consensus in what they will be responsible or accountable for, together as they agree to work week-to-week.

They don't stick within these boundaries either: they live a cross-functional lifestyle where they can float across responsibilities and functions for the purposes of learning.

You should never hear teammates say "That's not my job, that's their job" on an Agile team.

You should hear teammates say, "I was hired for research but this week I want to get into product strategy!"

Your team may have job titles, but their duties vary and may fall outside of those titles. Everyone should be celebrating and encouraging this kind of environment for all of the reasons we talk about regarding making strong Agile teams.

The more your team collaborates across functions:

1. The quicker they will get to Performing stage.
2. The more they will all "self-heal" from team conflict.
3. The stronger your self-organization becomes.
4. The stronger your continuous improvement becomes.

**Functions Are Not Roles**

The title you have doesn't mean that you only do that kind of work on a cross-functional team.

If you operate with different responsibilities, it does not mean you have multiple job titles.

A title is the function. A role is not a function. A role is a set of responsibilities that you agree to on an Agile cross-functional team.

**Daily Life on Agile Teams**

Let's talk about what day to day life looks like on Waterfall and on Agile cross-functional teams.

**Life on a Waterfall Team**

It's more common that teams call themselves agile and they don't live in the agile philosophies.

If you're building things on a waterfall team, this is what happens:

**Everybody in the beginning of a project agrees to the scope before doing the work. Someone produces what's called a Product Requirements Document which outlines everything in scope for the whole project.**

**When the product requirements are outlined, each team works in phases. Every team function is working alone. They meet alone, they talk alone, they decide alone. They don't communicate across functions. They don't collaborate across functions. They ship their work in silos to the next team.**

**When the project is finished, they ship it, and gather feedback from clients and users. When it may be too late!**

**Life on an Agile Team**

Life on an Agile team is the opposite of Waterfall teams.

The teams are working together across functions in cross-functional teamwork.

**When they start the work, all functions rally to understand high level goals and outcomes to achieve.**

**Everyone collaborates across functions to gather the most important requirements to deliver first.**

**Everyone collaborates to quickly deliver those requirements across research, design, and development. They check their work as they go with users and with clients.**

**They ship in usable, small chunks quickly, and gather feedback in order to pivot and refine their plans ahead.**`,
      },
    ],
  },
  {
    title: "Conflict Resolution",
    lessons: [
      {
        id: "agile-conflict-1",
        title: "Resolving Team Conflict as Service Leaders",
        youtubeId: "A8UPOsGDxCw",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/day-to-day-on-an-agile-team/resolving-team-conflict-as-service-leaders",
        content: `**Resolving Conflict is Key to Team Success**

Team strength must be maintained through conflict resolution. The only way to support psychologically safe, self-organized environments is to hold space for respectful conflict resolution among teammates.

When we work together, many challenges can arise. Work challenges arise. Challenges with stakeholders arise. Challenges among teammates arise.

We are all people with different personalities, experiences, and skills. We must provide each other with psychologically safe spaces to be heard and disagree, to build consensus. Through this, we must resolve conflict together.

Our primary goal on Tech Fleet projects is to learn to work in cross-functional Agile teams. We prioritize growth over skills.

As service-focused leaders, we are all responsible for the success of our projects and our team cohesion. Even the apprentices. Even the co-leads.

**Conflict Resolution Responsibilities for Team Members**

We're all responsible for each others success, and for resolving conflict:

1. **Conflict is not abuse.** It's natural. It's needed. It should be confronted. We must be willing to treat conflicts as opportunities for growth, even when we feel like we're not responsible.

2. **We can't change other people.** We should always reflect on our part in team interactions. We should reflect on what we're contributing to conflict. Opportunities for growth and leadership come from learning how to work with people we don't agree with, relate to, or even sometimes like. Through our understanding of what we're contributing to conversations, we can understand the other side. We can learn how to find ways for mutual benefit instead of demanding people align to our ways of thinking or behaving.

3. **We operate with a mindset of service to others.** As service leaders, we do not look for ways to police others, criticize, or blame. We help people play out scenarios themselves. We help them form their own conclusions on their own time. We are there in support and service to their growth, always. We are always looking to see how we can support others in productive, positive ways.

4. **We live in the real world.** Even though Tech Fleet is a collective, community-run organization, power dynamics still exist. It's a good idea to notice where you have implicit power, whether because of your role on the project, your level of experience, your status in a cultural or societal context, or your comfort with English. We're here to remove barriers to access and we always want to be mindful to be encouraging to those who may be facing obstacles, even if we didn't ourselves impose the obstacles.`,
      },
      {
        id: "agile-conflict-2",
        title: "The Process for Resolving Conflicts",
        youtubeId: "vKWOHRijDmI",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/day-to-day-on-an-agile-team/the-process-for-resolving-conflicts",
        content: `**Process for Resolving Team Conflicts**

• **Take ownership of your experience** from the beginning. Recognize that every situation has different perspectives. Start by naming your own experience. For example, "I notice that when I am coming to this meeting I am feeling a sense of dread that I may not be heard," instead of "you don't listen to me."

• **Do not assume a position of power-over**, even if you are a lead. By this, we mean do not threaten, coerce, or direct others to do things as though you are in command. Do not assume that anyone on the team has more "say" by virtue of their role.

• **Focus on the problem and factual information** not other people's personalities or your interpretation of other peoples' behavior. For example, you may feel that someone is being too pushy. You might say, "I am noticing that I don't feel good or comfortable with this direction yet. Can we consider what we would need to know to make a good decision?"

• **Use the situation to learn.** Humility is an essential aspect of service leadership. Remember, we all come into situations with our own lived experience and triggers. How can this situation help you to see how you might solve a problem like this at work or in your other relationships? What could you do differently to be more encouraging, supportive, or helpful to others on your team?

• **Avoid blame.** When we do root cause analysis, we may see that the structures we're working in are leading to some of the behavior we don't like. Look for ways for everyone to benefit, and avoid win-loss or "grudging compromise."

• **Seek support.** If you are in a situation where you feel that you're not being adequately considered, seek support. This does not mean "build a case for why you are right." Get personal support and perspective by consulting with a peer. This might be your group lead or project coordinator, or the Agile Coach if your project has one.

• **Ask for help.** If your issues can't be resolved in the group, or if you are overwhelmed and you need someone to listen, you can reach out to the Conflict Resolution Support Team. For violations of our Cultural Agreement, you report anonymously through our support form. Note that the support team is not here to direct or manage the team. As a community-driven org, our goal is to support one another to find good ways to handle tension and conflict, not to fix situations by making decisions for the team.

**A few other guidelines**

• **Do not use text-based communication** to resolve conflicts. If there is an issue, use voice and ideally video to communicate.

• **Get into the right headspace.** When you are feeling agitated, wronged, or angry at another person, you may not act as your best self. Take time to calm down. If you're in a meeting, you might say, "I need some time to consider this" or "I'd like to talk about this when I am feeling more centered."

• **Report explicit violations.** If someone is violating our community pledge, i.e. by harassing or abusing others, or by sharing sensitive data, or other explicit violations, please use our reporting process ASAP.

• **Use discretion to decide if you should address issues one-on-one or with the team.** If you can share what you're noticing compassionately and with openness to the perspectives of the other person, then a one-on-one dialogue can be great. Imagine how you would want someone to share an issue with you. If it feels like the group is being disrupted by a conflict, it can be very helpful to do a group exercise. Remember that our goal is always to find a way forward, not to assign blame.

• **Clarify the processes of the team.** Before the project starts, have a plan for dealing with conflict.

• **Recognize different communication styles.** Some people may simply be very passionate about a particular issue, and may not see their behavior as being "difficult."`,
      },
      {
        id: "agile-conflict-3",
        title: "Collective Agreement Violations",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-teamwork/day-to-day-on-an-agile-team/collective-agreement-violations",
        content: `**Collective Agreement Violations**

Per Tech Fleet's Community Collective Agreement, these are the **explicit violations** that should lead to reporting:

**Primary Violations**

• Violence: intentionally hurting or endangering any persons, groups, or "types of people".
• Unapproved sharing of confidential information.
• Characterizing anyone's personality or behavior on the basis of immutable identities or perceptions such as race, ethnicity, gender, sex, sexual orientation or national origin.
• Unnecessary personal attention or harassment after any clear request to stop it.
• Legal endangerment: Openly illegal activities, fraud, or hate speech.

**Secondary Violations**

• Failing to responsibly package and present media which includes, links or describes any Primary Violations.
• Preventing others from participating through coercion, threat, or suppression.
• Ignoring or neglecting a message of concern from any of our trusted community leaders (including the Board, staff, and Guild leadership).
• Circumventing a removal by using another identity, account or profile.

**How to report explicit violations**

Report issues to safespace@techfleet.org, and/or submit a ticket in #create-a-ticket for support in Discord. If you would like to report something anonymously, see our guidelines for reporting.

1. Report exactly what happened, and where. (Screenshots and links help!) If the Violation(s) aren't self-explanatory, explain your complaint.

**Actions taken once violations are reported**

1. Support Team will review the report and seek additional information if necessary.
2. Possible actions include: No action (no violation found), invitation to parties for a mediated conflict resolution process, encouragement to resolve the conflict as a team, suspension from the project, permanent removal from the project, or suspension or removal from Tech Fleet.

**Conflict Examples**

**When you should deal with something one-on-one or among the team, using principles of service leadership:**

1. You perceive a team member to be too controlling or directive
2. You find yourself in frequent conflict with a group member
3. Someone on the team is not doing work they agreed to
4. Someone on the team is not showing up to meetings
5. A person doesn't know how to do the work they agreed to do
6. You perceive a team member to be speaking disrespectfully to you
7. You disagree with someone's opinion and you feel they are not listening to you

**When you should involve your project coordinator or the Support Team:**

1. A lead is withholding information from apprentices
2. Attempts at resolving conflict using all the steps outlined in our conflict resolution approach have failed
3. You believe someone is lying or acting in bad faith to the team
4. Someone on the team is not using good data security practices
5. You believe the project is in jeopardy of not being completed or being materially delayed

**Violation Examples**

1. Someone on the team is using language that disparages others based on race, ethnicity, gender, disability, sexual orientation, or other immutable aspects of others' identities
2. Someone is sharing private data outside of the project
3. Someone is preventing other people on the team from participating
4. Someone on the team is using threats, ultimatums, or other forms of dominance or coercion to obtain compliance to their directives
5. Someone on the team is ignoring the communicated policies of Tech Fleet from the Board or Executive team
6. You have documented evidence of deceptive or antisocial behaviour that affects the team or project (being clear that this may be subject to further investigation)`,
      },
    ],
  },
  {
    title: "Agile Methods",
    lessons: [
      {
        id: "agile-method-1",
        title: "What is Scrum?",
        youtubeId: "ikxnRq8tscs",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-methods/scrum-method/what-is-scrum",
        content: `**Agile Philosophies vs. Agile Methods**

**What's the difference between Scrum and Agile?**

What's the difference between the methods and the philosophies of Agile?

Good questions! We're so glad you asked.

**Agile is a philosophy.**

**Scrum is a method of Agile.**

Agile philosophies are the mindsets you build to approach work in an Agile way. Building incremental value instead of value all at once.

Think back to the "Build the skateboard before you build the car" example in previous sections of the Agile Handbook.

Agile Methods are the processes that teams use to carry out the work in Agile ways.

**Examples of Agile Methods**

Here are some Agile Methods you see in the world:

1. Scrum
2. Kanban
3. SAFE, otherwise called Scaled Agile Framework
4. Extreme Programming
5. Google Design Sprints
6. So many more!

All of these are methods to carry out the Agile philosophies.

**Crawling Before Sprinting (See what we did there?)**

You have to build an Agile mindset before you learn how to operate an Agile method. Once you are ready to build strong teamwork foundations on Agile teams, and ready to mature your team from Forming to Performing, you are ready to operate Agile methods.

**Scrum Method**

Scrum is one of the most common methods for Agile work on teams.

In this method, work is always done in a fixed timeframe called a "Sprint". We "Scrum-ites" (followers of Scrum method) call this a "time box" of work. Sometimes this is called an iteration of work.

Each team agrees to whatever their fixed timebox of work will be. They agree to one week, two week, three week, or four week sprints.

This could change over time. A team who agrees to one-week sprints may want to change to two-week or three-week sprints. They have the right to do so as a self-organized, psychologically safe team of service leaders.

Scrum teams deliver usable functionality every "sprint".

**Scrum Process**

Scrum has specific chunks of responsibilities and specific meetings you'd run on a team.

1. **Build a backlog** of small amounts of work
2. **Refine the work** and estimate its level of complexity
3. **Do your "Planning":** Plan work in sprints
4. **Run** sprints
5. **Do your "Stand-Up":** Check in every day during the sprint
6. **Do your "Demo":** Demonstrate work in progress at the end of the sprint
7. **Do your "Retro":** Get together and reflect in your previous sprint to identify how to improve

**Scrum's Persona: "Just keep sprinting, just keep sprinting..."**

If Scrum were a persona, they'd be just like the fish from Finding Nemo:

"Just keep sprinting, just keep sprinting, sprinting sprinting sprinting sprinting".

The persona of Scrum is someone who's consistently operating and planning their next moves, just like a Scrum team.

**Goals and Motivations**

• Consistency in work intervals.
• Forecast the dates of releases.
• Increase team work capacity.
• Report progress to those outside the team.

**Benefits**

• Consistent planning of work items.
• Teams are able to get into a rhythm while working together.

**Pain Points**

• Rigid in flexibility (you should not change your sprint plan once it begins).
• Lots of work must happen before sprint teams can deliver work, it takes a lot of orchestration.

**How to Start Doing Scrum**

• Pick a consistent work interval called a "Sprint" (one week, two weeks, three weeks).
• Produce and deliver usable work every Sprint.
• Plan 1 to 2 Sprints ahead consistently.
• Once the sprint starts, work should not be added or removed, but often is decided by the team whether it is.`,
      },
      {
        id: "agile-method-2",
        title: "Scrum Team Functions",
        youtubeId: "xAXU4lAd0L8",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-methods/scrum-method/scrum-team-functions",
        content: `**Scrum Functions**

Scrum has 3 different roles that make up a Scrum team: the Product Owner, the Scrum Master role, and the "Doer" role. These 3 roles may be operated by one single person, or 3 separate people.

In Tech Fleet, the Product Strategy team typically owns the responsibilities for Scrum teams. This could change based on RACI chart decisions.

Remember: Roles are not job titles! They are simply commitments of responsibilities on teams that team members assign themselves each sprint. One person can own many roles.

**Product Owner Function**

This function is fulfilled by the Product Strategy Team in Tech Fleet.

The product owner function is the keeper of the backlog and the orchestrator of product work. They direct the priorities of work based on key needs and roadmap outcomes. They work in tandem with a product manager to set roadmap and vision, and focus on delivering the vision near-term.

• Product Backlog Management: Create, prioritize, and refine the product backlog, ensuring it is aligned with the product vision and strategy. Prioritization: Prioritize features and user stories based on business value, customer needs, and technical feasibility.
• Stakeholder Management: Collaborate with stakeholders, including customers, business owners, and team members, to ensure that product decisions align with their needs and expectations.
• Communication: Communicate product plans, priorities, and progress to stakeholders, including daily stand-ups, sprint planning, and sprint reviews.
• Market and Customer Research: Gather, manage, and prioritize market/customer requirements, acting as a customer advocate to articulate user needs.
• Decision Making: Make decisions on product features, priorities, and trade-offs, balancing business, customer, and technical requirements.
• Team Alignment: Ensure the development team understands the product vision, priorities, and goals, and aligns their work accordingly.
• Backlog Refinement: Refine the product backlog regularly, ensuring it remains relevant, up-to-date, and aligned with the product vision and strategy.
• Sprint Planning: Participate in sprint planning, ensuring the team has a clear understanding of the product backlog and priorities.
• Sprint Review: Participate in sprint reviews, ensuring the team demonstrates working software and receives feedback from stakeholders.

**Scrum Master Function**

This function is fulfilled by the Product Strategy Team in Tech Fleet.

The Scrum Master function is a facilitator and coaching function that ensures the Scrum framework is followed and the team is empowered to achieve its goals. Here are the key responsibilities:

• Facilitating Scrum Ceremonies: Lead daily stand-ups, facilitate sprint planning meetings, lead sprint review meetings, facilitate sprint retrospective meetings.
• Removing Impediments: Identify and remove obstacles that hinder the team's progress. Collaborate with team members and stakeholders to resolve issues and find solutions.
• Coaching and Mentoring: Coach team members in Scrum principles and practices. Mentor team members to improve their skills and knowledge. Encourage self-organization and empowerment within the team.
• Team Support: Provide guidance and support to team members as needed. Help team members understand their roles and responsibilities. Foster a positive and collaborative team culture.
• Reporting and Analysis: Analyze burndown charts and other metrics to identify trends and areas for improvement. Report on team progress and performance to stakeholders.

**"Sprint Do'er" Function**

Anyone who takes ownership of a ticket in a sprint is a Do'er.

In the industry, Scrum teams may call this the "development team", although they are not always developers! This is confusing to people who are not doing development in Scrum teams. This is why we call them "Do'ers". People doing the sprint work.

This function is fulfilled by the UX research team, the UX design team, the UX writing team, the project management team, and the development team in Tech Fleet.

**Scrum Team Activities and Responsibilities**

Here is a RACI chart of which roles on Agile teams are set to work on Agile deliverables.

1. **Responsible** = the person who performs the work.
2. **Accountable** = the person who oversees and ensures that the work progresses.
3. **Consulted** = the person who provides considerations and is asked advice.
4. **Informed** = the person who is told what happens after it happens.`,
      },
      {
        id: "agile-method-3",
        title: "Scrum Meetings",
        youtubeId: "MoFbcsMPnt4",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-methods/scrum-method/scrum-meetings",
        content: `**Scrum "Meeting Cadence"**

Meetings are often called "cadences" in Scrum, implying that they always keep happening. They become a part of the operating rhythm of the Scrum team. Every sprint, there are meeting "cadences" that always happen no matter what.

The Scrum Framework has the following meeting cadences:

1. Sprint backlog refinement
2. Level of effort estimation
3. Sprint planning
4. During the sprint
5. Daily standups
6. Sprint demo / Sprint review
7. Sprint retrospectives

**Backlog Refinement**

During backlog refinement, teams get together and discuss the work that's being documented before it starts. They discuss the scope of tasks, whether the work is feasible, what the design members and development members think need to be considered or included, and how complex is the work. The Product Owner duty owns this in the Scrum method. Backlog refinement should be a daily task for product teams. The result should be tasks for the team that are ready to be taken on in sprints.

**Sprint Planning**

Sprint Planning meeting is a meeting where the entire team gets together and plans their next upcoming sprint. Product Strategy teams should rely on the team to consult in priorities based on current and previous work, and the entire team should align together in the goals. The Product Owner duty owns this. Teams do this before every sprint begins. Outcomes include Sprint Goals, Updated Project Roadmap, and Refined backlog tasks.

**Level of Effort Estimation**

Level of effort estimation is an activity where teams estimate the complexity of upcoming work. Level of effort should be measured for all kinds of work: research, design, and development alike. Teams should gauge level of effort for their work so that they have an idea of what's too much work for a given iteration, and can track the changes over time.

Velocity is measured in story points per sprint. For instance, you'd describe the velocity of the team by saying "The team's velocity is 20 story points per sprint; the team can finish 20 story points of work on average every sprint".

**Daily Standups (AKA Daily Scrum)**

A daily standup is a full-team touch base for visibility. Everyone on the team needs to attend standup everyday to report on their progress:

1. What did you do yesterday?
2. What are you doing / did you do today?
3. What blockers do you have?

The most important aspect of this meeting is identifying blockers for the team, things that prevent team members from succeeding in their work. Together the team should discuss what they should do to remove the blockers together.

The entire team is accountable to run standup. The Product Owner and Scrum Master should not be attending these meetings. As a self-organized team, the team itself should run and hold these meetings. This is a live or asynchronous 15 minute meeting, every day.

**Sprint Demo / Sprint Review**

The sprint demo is a key moment in the sprint lifecycle. The team gets together at the end of their sprint and shows their work in progress. Whatever is half finished or fully finished is shown. They collect feedback from clients and teammates so that they can determine the direction they need to head for the next round of sprint planning. This happens at the end of every sprint increment.

**Sprint Retrospective**

The Sprint Retrospective is a time for the team to get together and reflect. They reflect on their work process and their teamwork together. They discuss:

1. What they liked that they want to continue
2. What they learned in hindsight that they want to change
3. What they lacked that they want to change
4. What they longed for that they want to change

This meeting should happen during each sprint increment. Outcomes include Sprint Retro action items, Updated Working Agreements, and Team process changes.

**One-Week Sprint Example**

Before the sprint: Sprint planning, refinement, level of effort estimation.
During the sprint: Daily standups, do the work that was planned, sprint demo at the end, sprint retro for previous sprint.`,
      },
      {
        id: "agile-method-4",
        title: "Common Agile Deliverables",
        youtubeId: "U-aZol4ybzc",
        sourceUrl: "https://guide.techfleet.org/agile-training-portal/agile-handbook/agile-methods/scrum-method/common-agile-deliverables",
        content: `**Common Agile Deliverables**

Here are some common deliverables when you are operating with Agile methods. Some of these pertain to the Scrum method only, and some of them are also created in other Agile methods.

**Project Roadmaps (AKA "Sprint Plans")**

This deliverable is exclusive to Scrum method. A sprint plan outlines a future plan for sprint work. It determines an estimate for the kinds of work that future sprints will hold based on the best guess of the team.

**Sprint Planning Items**

This deliverable is exclusive to Scrum method. Sprint Planning Items happen after a Sprint Planning meeting where the team outlines their shared goals for a sprint and assigns committed team members.

**Sprint Velocity**

This deliverable is exclusive to Scrum method. Sprint Velocity is a number that indicates how much work a team is estimated to be able to get done in one sprint.

**Kanban Boards**

This is not exclusive to Scrum method, it is common with Scrum teams and Kanban teams. Kanban Boards outline the team's process and allow teams to track the work in different statuses. This helps teams gain visibility into their collective work.

**Sprint Retro Boards**

This deliverable is exclusive to Scrum method. Sprint Retrospectives are a crucial part of the Agile process and Scrum Method. Sprint Retro Boards are the place where the team reflects in their process from the previous sprint.

**RACI Charts**

This is not exclusive to Scrum method, but common with Scrum teams. A RACI (which stands for Responsible, Accountable, Consulted, Informed) chart outlines daily tasks and breaks down who does them on Agile teams. This deliverable is a key alignment deliverable to come to agreements about how work gets done.

People on cross-functional teams wear different hats of responsibilities. This is a RACI chart in visual form!

**Working Agreements**

This is not exclusive to Scrum method, but common with Scrum teams. Working agreements are lists of statements that outline how a team agrees to work together. They are flexible and defined by the self-organized teams that run themselves.`,
      },
    ],
  },
];

/** Flat list of all lesson IDs for validation */
export const ALL_AGILE_LESSON_IDS = AGILE_COURSE_SECTIONS.flatMap((s) =>
  s.lessons.map((l) => l.id)
);

/** Flat list of all lessons in order */
export const ALL_AGILE_LESSONS = AGILE_COURSE_SECTIONS.flatMap((s) => s.lessons);

/** Total lesson count */
export const TOTAL_AGILE_LESSONS = ALL_AGILE_LESSON_IDS.length;

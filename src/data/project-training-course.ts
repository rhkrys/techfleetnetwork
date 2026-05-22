export interface CourseLesson {
  id: string;
  title: string;
  youtubeId: string | null;
  sourceUrl: string;
  content: string;
}

export interface CourseSection {
  title: string;
  lessons: CourseLesson[];
}

export const PROJECT_TRAINING_SECTIONS: CourseSection[] = [
  {
    title: "Introduction",
    lessons: [
      {
        id: "pt-intro-1",
        title: "Basics of Project Training in Our Organization",
        youtubeId: "2iobd4EyJas",
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/basics-of-project-training-in-our-organization",
        content: `**Overview**

Project training, otherwise known as apprenticeship training, is the chance for people to apply what they've learned in their education to a real team with real problem-solving and real clients. Our community offers this because we believe in the practice that counts toward experience building. We believe that teammates cannot do it alone, they must do it together across functions, and they need to decide together. Our roots of this community were started by people joining cross-functional teams to progress in work. At the same time, we've focused a lot of efforts on building training that coaches agile culture on teams. Now, as of 2025, all of our apprenticeship teammates are just "teammates" working together toward a common set of outcomes they agree to themselves. This is their training. People in our community level up and grow professionally through practice and decision making together. The project training we offer is the way they do this.

**Types of Clients**

All of our clients are existing nonprofit organizations with a 501(c)(3) or other nonprofit status. We partner with mission-driven organizations who are motivated to give back to our mission by being a client.

They support our mission by providing a forum for cross-functional teams to build experience together. Together, project trainees and clients work towards solving problems and delivering change in the world.

When we get together with clients, we go through a process of determining who they are, what their mission is, what they're trying to do, and why. We document this in a client intake and provide this on our project dashboard so that everyone in the community can see the goals and outcomes that the nonprofit is trying to achieve.

We encourage clients NOT to require an NDA or confidentiality agreement when working with us, and this is part of our terms of working with the community. We do this because we want our trainees to be able to produce story-driven case studies about their work so that they can showcase their growth.

**Types of Projects**

Our project training teams learn how to solve problems together through service design, strategy, web-based products, and discovery projects.`,
      },
      {
        id: "pt-intro-2",
        title: "Life as a Project Training Teammate",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/life-as-a-project-training-teammate",
        content: `**Life as a Project Training Teammate**

The world requires experience, a portfolio, and a lot of skills. In our community, you can be a teammate and share leadership with others, with none of that.

While some teammates carry experience, you do not need any prior experience to take a team role in Tech Fleet project training. Teammates are chosen based on their level of service leadership mindset and their level of agile mindset. You can build this as a community member through our Agile training and resources.

Check out the section in this handbook about Applying to Project Training for more information about what we look for in applicants, and how to apply.`,
      },
      {
        id: "pt-intro-3",
        title: "Team Structure on Tech Fleet Project Training",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/team-structure-on-tech-fleet-project-training",
        content: `**Team Structure**

Project structure is set up as a cross-functional structure.

Agile and empowered teams are all about sharing leadership and sharing decision making together.

Teammates share leadership with each other, and everyone makes decisions together in the ways of self-organization.

No one team member is "above" another lead or co-lead. Everyone pitches in to the work they want to commit to each week in sprint planning sessions through RACI Charts and Sprint Goals activities.

Teammates choose to perform different duties and responsibilities every time they prioritize work as a team.

**Teammate Responsibilities**

Each teammate is able to float across responsibilities as part of a cross-functional team. Each team position has daily expectations for responsibilities under each role they play.

1. Project management function
• Account management duties
• Project management duties
• Scrum master duties
• Product operations duties

2. Product strategy function
• Business analysis duties
• Product ownership duties
• Product management duties
• UX research duties

3. UX research function
• UX research duties
• UX strategy duties

4. UX design function
• UX design duties
• UX research duties
• UX strategy duties

5. UX writing function
• UX writing duties
• UX research duties
• UX strategy duties

6. Development function
• Front-end development duties
• Back-end development duties
• Solutions architecture duties
• QA duties

See the full details of cross-functional duties on the Project Success Handbook.`,
      },
      {
        id: "pt-intro-4",
        title: "Supported Team Functions in Project Training",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/supported-team-functions-in-project-training",
        content: `**Supported Team Functions in Project Training**

Tech Fleet project training supports the following team functions that teammates can contribute to:

1. **Product Strategy Function** — Business analysis, product ownership, product management, and UX research duties.

2. **Project Management Function** — Account management, project management, scrum master, and product operations duties.

3. **User Experience Functions** — UX research, UX design, UX writing, and UX strategy duties.

4. **Development Function** — Front-end development, back-end development, and QA duties.

5. **Solutions Architecture Function** — Solutions architecture duties focused on technical system design.

Each function has specific duties that teammates can float across as part of a cross-functional team. Teammates choose which functions they want to contribute to each sprint based on the team's goals and their own learning interests.`,
      },
    ],
  },
  {
    title: "Applying",
    lessons: [
      {
        id: "pt-apply-1",
        title: "How Tech Fleet Project Applications Work",
        youtubeId: "ClsWaGwjr-M",
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/how-tech-fleet-project-applications-work",
        content: `**Basics**

Tech Fleet has a long standing history of community-driven changes in its own process. From 2020 to 2025, we had a process where people fill out a single Google Forms survey every time they apply. Whenever they applied to multiple projects, they'd need to answer the same questions redundantly. This wasted a lot of time for members who were trying to get into teams.

As of February 2025, Tech Fleet has enacted a new set of applications that helps project coordinators and community members alike. These will save people time and ensure that project teams review useful information before picking team mates for project training.

Tech Fleet members now fill out two applications: the General Application they fill out once, and the Project Phase Application they fill out any time they want to join a training team. The information from the General Application is pulled into the Project Phase Application, saving members time and energy. They no longer have to answer every single question every single time.

**The General Application**

The General Application is designed to capture important information about yourself and your training desires only once. Members can fill it out once and update their answers over time. This saves time when people are applying to projects since they don't need to answer a lot of the questions again and again (as they did before).

The General Application has questions about:

1. Your time zone and availability
2. Your education outside of Tech Fleet
3. Your prior engagement and training within Tech Fleet
4. Your desired skill sets to focus on
5. Your Service Leadership mindset
6. Your Agile mindset

**The Project Phase Application**

You fill out the Project Phase Application every time you apply to a project training phases in Tech Fleet. The information from the General Application is pulled into the Project Phase Application, saving members time and energy. They no longer have to answer every single question every single time.

The Project Phase application has questions about:

1. Have you completed your Tech Fleet General Application?
2. Information about your desired project position
3. Questions related to projects

**The Process for Projects**

Tech Fleet continually iterates on its project management lifecycle to improve the success for all who are involved.

As of this moment, the process for projects is broken into chunks:

1. 4 weeks applications and team building
2. 2 weeks of pre-kickoff work with the team
3. 8 weeks of project work during the phase
4. 1 week of hand-off work after the phase

**How the Applications are Used**

The Project Coordinator Guild and the co-leads who are picked on teams review these answers when you apply to projects before picking team mates.

We know what you're thinking: "I'm not good enough to answer these questions". Have no fear! This is not true. We take people of all background and skill levels on Tech Fleet projects. After all, that's why Tech Fleet is here: to help you grow for a great tech career!

We do not use this data to disqualify anyone, but we do use it to see where you are in your journey to the tech field and in the Tech Fleet community.

**Tech Fleet's Privacy Policy for Application Information**

Tech Fleet is committed to keeping our community members and their data secure and private online. We do not share any of your application data with third parties. We use this application data for project training only. We have policies that describe how we use and store the data we collect about our members.`,
      },
      {
        id: "pt-apply-2",
        title: "Steps to Apply to Project Training",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/steps-to-apply-to-project-training",
        content: `**Steps to Apply to Project Training**

• Join Discord

• Read about how Tech Fleet project training is defined to make sure you understand how to put it on your resume

• Prepare for Tech Fleet project training by:

1. Engage within the community
2. Read the Agile Handbook
3. Read the Project Success Handbook
4. Read the Teammate Handbook
5. Observe projects
6. Train in Agile

• Check out the Current Openings

• Fill out the General Application and the Project Phase Application

• Update your General Application answers as you need.

• Proceed with the application process as described in the Project Timelines and Application Process section.`,
      },
      {
        id: "pt-apply-3",
        title: "Application Requirements",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/application-requirements",
        content: `**What you don't need:**

1. A degree
2. A resume
3. A portfolio
4. Prior experience (even as a lead)

**What you should have:**

**Completed Actions in Tech Fleet**

1. Previously observed project teams
2. Previously taken the Service Leadership Masterclass
3. Read the Apprentice Handbook, Co-Lead Handbook, Agile Handbook, Guidelines, and info about Life in Tech Fleet
4. Understand what questions we ask when applying
5. Complete both the General and Project Phase Applications

**Built Experiences and Mindsets**

1. A passion for philanthropy and peer-to-peer collaboration
2. A willingness to put in the time and energy in the program
3. Ability to commit an average of 15 to 20 hours to the project phase as part of a team
4. Prior education-building foundation (bootcamp, cert, school, self-training)
5. Knowledge about your role
6. Knowledge about Agile philosophies
7. Knowledge about Service Leadership`,
      },
      {
        id: "pt-apply-4",
        title: "Project Timelines and Application Process",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/project-timelines-and-application-process",
        content: `**The Project Phase Timelines**

Tech Fleet project team training involves a lot of people and a lot of parts. This page outlines the steps involved before a project phase begins, during the phase kickoff, during the project phase, and in between project phases.

**Before the Project Phase Begins**

**Duration:** 6 weeks

**Steps:**

1. Tech Fleet meets with client to collect needs.
2. Client and Tech Fleet agree to desired scope and deliverables.
3. Tech Fleet determines project roles that are needed for the project.
4. Tech Fleet project coordinator creates applications.
5. Tech Fleet opens applications to the community for 5 days.
6. Applications close.
7. Co-leads who apply get interviewed by the project coordinator.
8. Co-leads are selected.
9. Co-leads review apprentice applications from the General and Project Phase applications to choose their interviewees based on who has applied.
10. Co-leads reach out and schedule up to 10 interviews per team with potential apprentices who've applied.
11. Co-leads pick up to 4 apprentices per team position from those they've interviewed.
12. Team does ice breakers.
13. Team starts the Pre-Kickoff for 2 weeks.
14. Project sprint kicks off for 8 weeks.
15. After the 8 weeks of work, the team gets together and compiles hand-off for 1 week.

**Project Phase Pre-Kickoff**

**Duration:** 3 weeks

**Steps:**

1. The team does ice breakers together
2. The Agile coach works with the team to discuss Service Leadership and Agile Philosophies in team work
3. The Agile coach works with the team to discuss how to resolve team conflict
4. The Agile coach works with the team to produce the following for kickoff:
• Client kickoff meeting
• Project goals and deliverables
• A team working agreement
• Team roles and responsibilities (called a RACI chart)
• A sprint plan for all teams to map out work
• Access to Notion project repository, Discord channels, and meeting link scheduling
• A backlog of work items based on the sprint plan

**During the Project Phase**

**Duration:** 8 weeks

**Steps:**

1. Each sprint, the team progresses on work and demonstrates their progress in sprint demos.
2. Each sprint, the team adjusts their sprint plans and backlog based on collaborations with the client and user.
3. Each sprint, the project managers fill out a progress check-in to identify how their team is doing.
4. Before the current project begins, the Tech Fleet Board will start the process of planning the next phase of work with the client and the team.
5. Current team mates who are interested in re-applying provide their interests with the project coordinator.
6. The next phase of the project is anticipated to open during or right after the previous phase so that current teams have a chance to meet with new teams and discuss their progress together.

**Project Hand-off Week**

**Duration:** 1 week

**Steps:**

1. The team documents their hand-off based on the Notion template provided to them.
2. The team holds a final retrospective to reflect on their work and how it went.
3. The team works with Agile coaches and project coordinators to discuss how they will tell their story of the project work within their upcoming case study.

**In-Between Project Phases**

**Duration:** Ongoing

**Steps:**

1. The Tech Fleet Board, project coordinators, and the client keep in touch about the progress of the project work.
2. The project coordinators update the project dashboard information from the work in the latest phase.
3. The Tech Fleet Board and project coordinators work together to ensure people have what they need to compile their case studies.`,
      },
      {
        id: "pt-apply-5",
        title: "General Application Questions",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/application-questions/tech-fleet-general-application-questions",
        content: `You only fill out the General Application once! You can update your answers. Think of it like stored profile information.

**General Application Questions**

These are the questions that we ask you on the General Application.

**Basic Information**

1. We ask you to sign in with the email you used to Join Tech Fleet Discord. Before you complete the project applications, join Tech Fleet Discord.
2. Tell us about yourself! Share any information you think is relevant for professional background and help your future team mates get to know you.
3. What Time Zone do you live in?
4. Tech Fleet team mates are expected to commit 15 to 20 hours on project team training. This is flexible, and your team builds the schedule together. Are you committed to contribute 15 to 20 hours a week during project training?
5. Provide your Portfolio URL if you have one
6. Provide your LinkedIn URL
7. In what areas do you want to gain experience on Tech Fleet training?
8. Within your career, what tech career roles are you interested in pursuing?
9. What kinds of team roles are you interested in joining?
10. What specifically are you looking to learn from being on projects?
11. Have you previously observed project training teams in Tech Fleet?
12. (If Yes) What have you learned while Observing Tech Fleet project training teams?
13. Have you previously engaged in Tech Fleet community before?
14. (If Yes) In what ways have you previously engaged in the Tech Fleet community so far?
15. During what times are you available in the weekdays?

**Skills and Training**

1. What best describes your current or previous education?
2. List any Tech Fleet masterclasses you are currently taking or previously taken before
3. What technical and interpersonal skills do you already feel confident in?
4. What technical and interpersonal skills do you want to learn the most?
5. What team practices do you already feel confident in?
6. What team practices do you want to learn the most?

**Service Leadership Skills (AKA Service Leadership)**

1. What is Service Leadership to you?
2. In what ways would you / do you act as a Service Leader to yourself and others on teams as an apprentice or a co-lead?
3. What challenges do you currently face in Service Leadership that you are working on?
4. What would you do in a situation where a person on a team is not acting as a service leader to you or to others?

**Agile Skills**

1. What's the difference between Agile and Waterfall methods?
2. How do you approach building psychologically safe environments on teams as an apprentice or a co-lead?
3. How do you apply the Agile philosophies in your day-to-day work while working on teams?
4. What, if any, challenges have you faced while collaborating with different roles on teams? How have you tried to solve those challenges?`,
      },
      {
        id: "pt-apply-6",
        title: "Updating the General Application",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/updating-the-general-application",
        content: `**The General Application**

The General Application is the application you can fill out and reuse across project applications. We ask you questions about yourself and your training for Agile cross-functional teams. We primarily look for people who have observed Tech Fleet teams, trained in Service leadership, and prepared in Agile philosophies on teams. You may not have done this when you initially filled out the General App, but have no fear. You can update it over time!

**Update Your Answers Over Time**

As you observe and take masterclasses in Tech Fleet, your knowledge about service leadership and Agile philosophies will grow over time. Update your answers on the General Application whenever you learn something new. This way, when teams review your applications for project training, it's based on the latest knowledge you have about these important subjects.

**How To Update the Tech Fleet General Application**

1. Go to the General Application.
2. Login with your email you used to sign up to Tech Fleet Discord.
3. You will receive an email with a security code, enter the security code to login.
4. Go to your profile at the top right.
5. Select the "Past Submissions" option.
6. Select one of your previous submissions of the Tech Fleet General application.
7. Update your answers and submit!

The next time you apply, you can use your updated answers on the Project Phase Application.`,
      },
      {
        id: "pt-apply-7",
        title: "Project Phase Application Questions",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/application-questions/tech-fleet-project-phase-application-questions",
        content: `**Project Phase Application Questions**

These are the questions that we ask you on the Project Phase Application.

**Basic Information**

The General Application will pull your basic information into the Project Phase application.

1. First the application asks you if you have filled out the General Application.
• If not, it will redirect you to the General Application.
• If yes, it will ask you to select the General Application responses you want to use.

**Team Position Interest**

1. Which open project phase do you want to apply to?
2. Are you applying as an Apprentice or Co-Lead?
3. What team positions do you want to apply to? (Choose all that apply)
4. Did you participate in a previous phase of this Tech Fleet project?
• If yes: What team position did you join in the previous phase?
• If yes: Were you operating as a co-lead or apprentice in the previous phase?
• If yes: What did you learn in the previous phase that you want to continue doing?
• If yes: What did you learn in the previous phase that you'd do differently this phase?
• If yes: How will you help your team mates who are new to this project succeed?
• If no: How has your prior engagement (either in projects, in masterclasses, or observing teams) in Tech Fleet community prepared you for this team role?

**Project-Specific Questions**

1. Why are you passionate about being on this project?
2. What do you know about the client and the project that you're applying to? Tell us about it.
3. How would you like to contribute to cross-functional teamwork on the team?
4. How will you contribute to this project's successful outcomes as an apprentice or a co-lead and as a teammate?`,
      },
    ],
  },
  {
    title: "Tips",
    lessons: [
      {
        id: "pt-tips-1",
        title: "Key Traits We Look For in Team Mates",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/interview-guide-for-tech-fleet-project-training/key-traits-we-look-for-in-team-mates",
        content: `**Key Traits of Successful Teammates**

1. Agile philosophy mindset
2. Service Leader attitude
3. No ego
4. Here to grow together, not to just produce work
5. Willingness to fail and learn in the Agile way
6. Willingness to be a cross-functional team mate
7. Aligned with Tech Fleet's values and mission
8. High passion for giving back to the nonprofits we work with`,
      },
      {
        id: "pt-tips-2",
        title: "Teammate Interview Guide for Project Coordinators",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/interview-guide-for-tech-fleet-project-training/teammate-interview-guide-for-project-coordinators",
        content: `**Did you know?**

Do not record video or audio, or AI transcription of team interviews. Rely on note-taking during the interview. This is for the sake of data privacy policies in Tech Fleet. If you must record, you must delete the recording after the meeting. You must ask permission to record.

**Introduction**

1. Break the ice a little before beginning
2. Tell them the agenda:
• We will not record this session but I may take notes for my own recruiting efforts
• I'd like to get to know you and learn what you'd like to get out of project training
• I'd like to tell you more about how Tech Fleet projects operate in our apprenticeship training
• I'd like to talk about Service leadership and Agile with you
• I'd like to leave room for questions at the end
• How does that sound to you?
3. Tell me about yourself — professional background, other key things to get to know them as a person
4. How long have you been in the Tech Fleet community?
5. How much do you know about Tech Fleet community?
• If not much, tell them the history of Tech Fleet
6. How is it going so far for you in the community?
7. Have you ever been on a Tech Fleet project before?

**If They Have Never Been on Tech Fleet Projects**

**Tech Fleet Basics:**
• Tech Fleet is an apprenticeship training organization.
• Teams are trained on real Agile methodologies, which are very different from how a lot of schools teach UX and product work, but this is a safe environment to fail and learn.
• The priority on a team is to grow and learn, NOT to produce work. This is not a competitive environment.
• It's an environment to get things wrong and to embrace failure. Team mates need to be given safe spaces to learn.
• When you're on a team, you're in an apprenticeship training. You are not in a job or volunteer position.
• Teams work with nonprofit clients.
• Team members are expected to perform a new way of working as they will be expected in the industry: Agile.

**Agile and Shared Leadership Basics:**
• Agile is a way of building things that provides incremental value instead of value at the end of projects.
• UX work and development happens continuously and at the same time.
• We work in the Scrum method.
• We do "sprints": 2 weeks of work at a time, and deliver small chunks of UX work every 2 weeks.
• Each sprint, the teams deliver research, design, and product work in parallel.
• Each project phase is 4 sprints.
• When one project phase ends, the team documents a handoff and then we open applications for the next project.
• Instead of working alone in a specific title, you will have the opportunity to float across different activities based on what you want to do.
• We have Agile coaches that are training in this community who work with teams to coach Agile and get them going as a Scrum team.

**Teammate Expectations:**
• Teammates share leadership on teams. We are all peers, no one is an expert, no one is the boss. No one provides the answers. Everyone is in service to others' growth.
• There is no hierarchy on the team. Teammates are equals to each other.
• Every sprint, everyone commits to the work they want to do based on a shared outcome of the team.
• Teammates are all service leaders to each other, and provide psychological safety to each other.

**Suggested Candidate Questions:**

• How would you explain service leadership in your own words?
• Service leaders transfer the power to their teammates. How will you do this on your team?
• How do you live as a service leader to your peers?
• How would you contribute to coaching your team in the Agile philosophies?
• Some teams find themselves in situations where teammates wait to be told what to do. Some people tell others what to do. This is the opposite of the dynamic we want. We want collective decision making as a unified team. What does this mean to you? How would you accomplish this on your team?
• How would you handle a situation where a team mate is not being a service leader to you or to someone else?
• How would you handle situations of uncertainty, or situations where the client is not providing direction you need as a team?
• Do you have any questions for me?`,
      },
      {
        id: "pt-tips-3",
        title: "Application Tips",
        youtubeId: null,
        sourceUrl: "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/application-tips",
        content: `**Application Tips**

1. **Be Vigilant** — Look out for information on upcoming Tech Fleet projects by checking the #project-openings channel and the Tech Fleet Newsletter.

2. **Follow & Contribute** — At Tech Fleet we believe that contribution = growth. Those who contribute should be awarded more opportunities to contribute further. Being a project observer is a great way of understanding the working dynamics of a Tech Fleet team and making a contribution to the community.

3. **Prepare for Agile and Service Leadership** — All Agile team mates are expert collaborators before anything else. People on Tech Fleet projects often must build a mindset of Agile and of Service Leadership before they can fully succeed in teams and contribute their best work. Take the Service Leadership Masterclass and read the Agile handbook before applying to maximize your success.

4. **Shadow shadow shadow!** — Observers gain advantage in Tech Fleet programs because they've seen the work happen on teams. We recommend you shadow for one full week, watching as many team meetings on one project that you can, so you get a full sense of the work ahead. Show in your application responses that you've shadowed, and your leads will be able to tell you've prepared for the apprenticeship program.

5. **Apply apply apply!** — When project applications open up, they are for anyone wanting to apply. We don't ask for a resumé or a portfolio. What we are most interested in is your willingness to learn and help others do the same. This sentiment should be reflected in your application.

6. **Write with quality over quantity** — Check out the application questions to see how to prepare. When you write your application responses, be sure to write detailed and concise answers with as much context as you can build. When leads look at your responses they only have these to go off, and your history in Tech Fleet, to decide whether you're a good fit to interview. So don't be afraid to show your passion, show your chops, show your gumption in these responses.`,
      },
    ],
  },
];

export const ALL_PROJECT_TRAINING_LESSONS = PROJECT_TRAINING_SECTIONS.flatMap(
  (s) => s.lessons
);

export const ALL_PROJECT_TRAINING_LESSON_IDS = ALL_PROJECT_TRAINING_LESSONS.map(
  (l) => l.id
);

export const TOTAL_PROJECT_TRAINING_LESSONS = ALL_PROJECT_TRAINING_LESSON_IDS.length;

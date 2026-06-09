import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  firstName?: string
  projectName?: string
  statusUrl?: string
}

const ProjectApplicationSubmittedEmail = ({ firstName, projectName, statusUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Your application for ${projectName || 'the project'} is in.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={headerSection}>
          <Text style={brandTag}>TECH FLEET NETWORK</Text>
        </Section>

        <Heading style={h1}>Your project application is submitted</Heading>

        <Text style={text}>Hi {firstName || 'there'},</Text>

        <Text style={text}>
          We received your application{projectName ? ` for ${projectName}` : ''}. The
          coordinator will review and follow up with next steps.
        </Text>

        {statusUrl && (
          <Section style={ctaSection}>
            <Button style={ctaButton} href={statusUrl}>
              View application status
            </Button>
          </Section>
        )}

        <Hr style={hr} />

        <Text style={text}>
          You can update your responses anytime before a decision is made.
        </Text>

        <Text style={signature}>The Tech Fleet team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ProjectApplicationSubmittedEmail,
  subject: (data: Record<string, any>) =>
    data?.projectName ? `Your application for ${data.projectName} is in` : `Your project application is in`,
  displayName: 'Project application submitted',
  previewData: {
    firstName: 'Jane',
    projectName: 'Acme — Discovery',
    statusUrl: 'https://techfleet.network/applications/projects',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '580px', margin: '0 auto' }
const headerSection = { textAlign: 'center' as const, marginBottom: '24px' }
const brandTag = { fontSize: '13px', fontWeight: '700' as const, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, color: '#18181b', margin: '0 0 20px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#3f3f46', lineHeight: '1.7', margin: '0 0 16px' }
const ctaSection = { textAlign: 'center' as const, margin: '24px 0' }
const ctaButton = { backgroundColor: '#0056A7', borderRadius: '6px', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, padding: '12px 28px', textDecoration: 'none' }
const hr = { borderColor: '#e4e4e7', margin: '24px 0' }
const signature = { fontSize: '15px', fontWeight: '600' as const, color: '#18181b', margin: '0' }

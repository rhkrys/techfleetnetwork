import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Tech Fleet Network"

interface Props {
  firstName?: string
  applicationsUrl?: string
  projectsUrl?: string
}

const GeneralApplicationSubmittedEmail = ({ firstName, applicationsUrl, projectsUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Tech Fleet general application is in — here is what happens next.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={headerSection}>
          <Text style={brandTag}>TECH FLEET NETWORK</Text>
        </Section>

        <Heading style={h1}>Your general application is submitted</Heading>

        <Text style={text}>Hi {firstName || 'there'},</Text>

        <Text style={text}>
          We received your general application. Thank you for sharing your background
          and your view on service leadership.
        </Text>

        <Text style={text}>
          You can now apply to open project openings. Reviewers will reach out as
          opportunities match your experience.
        </Text>

        {projectsUrl && (
          <Section style={ctaSection}>
            <Button style={ctaButton} href={projectsUrl}>
              Browse project openings
            </Button>
          </Section>
        )}

        <Hr style={hr} />

        <Text style={text}>
          You can review or update your application anytime from your Applications page.
          {applicationsUrl ? ` Visit ${applicationsUrl}` : ''}
        </Text>

        <Text style={signature}>The Tech Fleet team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: GeneralApplicationSubmittedEmail,
  subject: () => `Your Tech Fleet general application is in`,
  displayName: 'General application submitted',
  previewData: {
    firstName: 'Jane',
    applicationsUrl: 'https://techfleet.network/applications',
    projectsUrl: 'https://techfleet.network/project-openings',
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

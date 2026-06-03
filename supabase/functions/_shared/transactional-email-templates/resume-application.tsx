import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Tech Fleet Network"

interface ResumeApplicationProps {
  firstName?: string
  sectionLabel?: string
  resumeUrl?: string
}

const ResumeApplicationEmail = ({ firstName, sectionLabel, resumeUrl }: ResumeApplicationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Your ${SITE_NAME} application is saved — pick it back up where you left off.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={headerSection}>
          <Text style={brandTag}>TECH FLEET NETWORK</Text>
        </Section>

        <Heading style={h1}>Your application is saved</Heading>

        <Text style={text}>Hi {firstName || 'there'},</Text>

        <Text style={text}>
          You started your general application a couple of days ago — it's safe and waiting for you.
          {sectionLabel ? ` You left off on ${sectionLabel}.` : ''} Most members finish in under 20 minutes.
        </Text>

        {resumeUrl && (
          <Section style={ctaSection}>
            <Button style={ctaButton} href={resumeUrl}>
              Resume application
            </Button>
          </Section>
        )}

        <Hr style={hr} />

        <Text style={text}>
          Submitting unlocks project openings and reviewer feedback. We'd love to see what you've been working on.
        </Text>

        <Text style={signature}>The Tech Fleet Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ResumeApplicationEmail,
  subject: () => `Your Tech Fleet application is saved — pick it back up`,
  displayName: 'Resume application reminder',
  previewData: {
    firstName: 'Jane',
    sectionLabel: 'Service leadership',
    resumeUrl: 'https://techfleet.network/applications/general',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '580px', margin: '0 auto' }
const headerSection = { textAlign: 'center' as const, marginBottom: '24px' }
const brandTag = { fontSize: '13px', fontWeight: '700' as const, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, color: '#18181b', margin: '0 0 20px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#3f3f46', lineHeight: '1.7', margin: '0 0 16px' }
const ctaSection = { textAlign: 'center' as const, margin: '24px 0' }
const ctaButton = { backgroundColor: '#3B82F6', borderRadius: '6px', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, padding: '12px 28px', textDecoration: 'none' }
const hr = { borderColor: '#e4e4e7', margin: '24px 0' }
const signature = { fontSize: '15px', fontWeight: '600' as const, color: '#18181b', margin: '0' }

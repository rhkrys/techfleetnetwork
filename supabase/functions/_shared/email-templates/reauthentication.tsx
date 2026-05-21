/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Tech Fleet verification code. Expires shortly.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Verify it's you</Heading>
        <Text style={text}>Enter the code below in Tech Fleet to confirm a sensitive action on your account.</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>You're getting this because someone tried to take a sensitive action on your Tech Fleet account. If that wasn't you, ignore this email and consider resetting your password. Reply directly to reach a person.</Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#141726', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 25px' }
const codeStyle = { fontFamily: 'Courier, monospace', fontSize: '22px', fontWeight: 'bold' as const, color: '#0056A7', margin: '0 0 30px' }
const footer = { fontSize: '12px', color: '#64748b', margin: '30px 0 0' }

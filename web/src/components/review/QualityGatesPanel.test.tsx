import { render, screen } from '@testing-library/react'
import QualityGatesPanel from './QualityGatesPanel'

test('parses typed YAML block', () => {
  const input = `\`\`\`yaml type=impl-quality-gates
level: standard
gates:
  - type: build
    command: go build
    required: true
\`\`\``

  render(<QualityGatesPanel gatesText={input} />)
  expect(screen.getByText(/go build/)).toBeInTheDocument()
})

test('handles parse error gracefully', () => {
  const input = `\`\`\`yaml type=impl-quality-gates
level: standard
gates:
  - type: build
    command: go build
    required: true
    invalid syntax here [[[
\`\`\``

  render(<QualityGatesPanel gatesText={input} />)
  expect(screen.getByText(/Invalid quality gates format/)).toBeInTheDocument()
})

test('shows message when no gates defined', () => {
  render(<QualityGatesPanel gatesText="" />)
  expect(screen.getByText(/No quality gates defined/)).toBeInTheDocument()
})

test('parses multiple gates with required and optional', () => {
  const input = `\`\`\`yaml type=impl-quality-gates
level: standard
gates:
  - type: build
    command: go build
    required: true
  - type: test
    command: go test
    required: false
    description: Unit tests
\`\`\``

  render(<QualityGatesPanel gatesText={input} />)
  expect(screen.getByText(/go build/)).toBeInTheDocument()
  expect(screen.getByText(/go test/)).toBeInTheDocument()
  expect(screen.getByText(/Unit tests/)).toBeInTheDocument()
  expect(screen.getByText(/1 required, 1 optional/)).toBeInTheDocument()
})

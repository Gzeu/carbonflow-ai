# Contributing to CarbonFlow AI

We love your input! We want to make contributing to CarbonFlow AI as easy and transparent as possible.

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## Pull Request Process

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Code Style Guidelines

### Frontend (React/TypeScript)
- Use TypeScript for all new files
- Follow ESLint and Prettier configurations
- Use functional components with hooks
- Write meaningful component and variable names
- Add JSDoc comments for complex functions

### Backend (Node.js/Express)
- Use ES6+ features
- Follow RESTful API conventions
- Add input validation for all endpoints
- Use meaningful error messages
- Write unit tests for business logic

### AI Engine (Python)
- Follow PEP 8 style guide
- Use type hints for function signatures
- Add docstrings for all functions
- Write comprehensive unit tests
- Use meaningful variable names

### Smart Contracts (Rust)
- Follow Rust naming conventions
- Add comprehensive comments
- Write integration tests
- Use meaningful error messages
- Follow MultiversX best practices

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation changes
- `style:` code style changes (no logic changes)
- `refactor:` code refactoring
- `test:` adding or updating tests
- `chore:` maintenance tasks

### Examples:
```
feat: add satellite image analysis API endpoint
fix: resolve MultiversX wallet connection issue
docs: update API documentation for carbon verification
test: add unit tests for AI verification engine
```

## Issue Reporting

We use GitHub Issues to track bugs and feature requests:

### Bug Reports
- Use the bug report template
- Include steps to reproduce
- Add screenshots if applicable
- Specify your environment (OS, browser, etc.)

### Feature Requests
- Use the feature request template
- Explain the use case
- Describe the expected behavior
- Add mockups if possible

## Development Setup

### Prerequisites
- Node.js 18+
- Python 3.9+
- Docker & Docker Compose
- Git

### Local Development

```bash
# Clone the repository
git clone https://github.com/Gzeu/carbonflow-ai.git
cd carbonflow-ai

# Install dependencies
npm run setup

# Copy environment file
cp .env.example .env
# Edit .env with your configurations

# Start development environment
docker-compose up
```

### Testing

```bash
# Run all tests
npm run test

# Run specific component tests
npm run test:frontend
npm run test:backend
npm run test:ai
```

## Code Review Guidelines

### For Reviewers
- Be constructive and respectful
- Focus on code quality and maintainability
- Check for security vulnerabilities
- Verify tests are included
- Ensure documentation is updated

### For Contributors
- Respond to feedback promptly
- Make requested changes
- Keep PRs focused and atomic
- Write clear PR descriptions
- Link related issues

## Security

Please report security vulnerabilities to security@carbonflow.ai rather than using GitHub Issues.

## Community Guidelines

- Be respectful and inclusive
- Help others learn and grow
- Share knowledge and resources
- Follow our Code of Conduct
- Have fun building the future of carbon trading! 🌱

## Recognition

Contributors will be recognized in our README and may be eligible for:
- Contributor badges
- Early access to features
- Community governance tokens
- Speaking opportunities at conferences

Thank you for contributing to a more sustainable future! 🌍

import nextConfig from 'eslint-config-next';

export default [
  ...nextConfig,
  {
    rules: {
      // Prop-to-local-state sync via useEffect is a valid pattern in controlled components
      'react-hooks/set-state-in-effect': 'warn',
      // Existing code accesses refs during render in a few safe patterns
      'react-hooks/refs': 'warn',
      // Date.now() in derived render values is acceptable for countdown UIs
      'react-hooks/purity': 'warn',
    },
  },
];

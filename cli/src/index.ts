import figlet from 'figlet';

import { Command } from 'commander';
import { view } from './actions/view';
import chalk from 'chalk';

const packageJson = require('../../package.json');

const program = new Command();

console.log(chalk.blue(figlet.textSync("ArchDoc")));

program
  .version(packageJson.version)
  .description("Web UI used to visualize and explore ArchDoc models.")
  .argument('<path_to_spec_file>', 'ArchDoc spec file to view')
  .action((path_to_spec_file) => {
    view({
        archdocSpecFilePath: path_to_spec_file,
        port: 7123
    })
  })
  .parse(process.argv);

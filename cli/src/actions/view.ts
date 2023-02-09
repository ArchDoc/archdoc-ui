import express from 'express';
import path from 'path';
import open from 'open';

export interface ViewActionConfig {
    archdocSpecFilePath: string,
    port: number
}

export const view = (config: ViewActionConfig) => {
    console.log(`Configuring server...\n`);

    const app = express();

    const archDocSpecPath = path.resolve(config.archdocSpecFilePath);
    app.use("/model", express.static(archDocSpecPath));

    const uiBuild = path.join(__dirname, '..', '..', '..', 'ui', 'build');
    app.use("/", express.static(uiBuild));

    const url = `http://localhost:${config.port}`;

    app.listen(config.port, () => {
        console.log(`Serving ArchDoc viewer on ${url}...`);

        open(url);
    });

    
}
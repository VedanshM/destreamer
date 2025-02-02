import { chromeCacheFolder } from './destreamer';
import { ERROR_CODE } from './Errors';
import { logger } from './Logger';
import { getPuppeteerChromiumPath } from './PuppeteerHelper';
import { Session } from './Types';

import fs from 'fs';
import jwtDecode from 'jwt-decode';
import puppeteer from 'puppeteer';


export class TokenCache {
    private tokenCacheFile = '.token_cache';

    public Read(): Session | null {
        if (!fs.existsSync(this.tokenCacheFile)) {
            logger.warn(`${this.tokenCacheFile} not found. \n`);

            return null;
        }

        const session: Session = JSON.parse(fs.readFileSync(this.tokenCacheFile, 'utf8'));

        type Jwt = {
            [key: string]: any
        }
        const decodedJwt: Jwt = jwtDecode(session.AccessToken);

        const now: number = Math.floor(Date.now() / 1000);
        const exp: number = decodedJwt['exp'];
        const timeLeft: number = exp - now;

        if (timeLeft < 120) {
            logger.warn('Access token has expired! \n');

            return null;
        }

        logger.info(`Access token still good for ${Math.floor(timeLeft / 60)} minutes.\n`.green);

        return session;
    }

    public Write(session: Session): void {
        const s: string = JSON.stringify(session, null, 4);
        fs.writeFile(this.tokenCacheFile, s, (err: any) => {
            if (err) {
                return logger.error(err);
            }

            logger.info(`Fresh access token dropped into ${this.tokenCacheFile} \n`.green);
        });
    }
}


export async function refreshSession(url: string): Promise<Session> {
    const videoId: string = url.split('/').pop() ?? process.exit(ERROR_CODE.INVALID_VIDEO_GUID);

    const browser: puppeteer.Browser = await puppeteer.launch({
        executablePath: '/bin/google-chrome-stable',
        headless: true,            // NEVER TRUE OR IT DOES NOT WORK
        userDataDir: process.env.HOME + '/.config/google-chrome',
        args: [
            '--disable-dev-shm-usage',
            '--fast-start',
            '--no-sandbox'
        ]
    });

    const page: puppeteer.Page = (await browser.pages())[0];
    await page.goto(url, { waitUntil: 'load' });

    await browser.waitForTarget((target: puppeteer.Target) => target.url().includes(videoId), { timeout: 30000 });

    let session: Session | null = null;
    let tries = 1;

    while (!session) {
        try {
            let sessionInfo: any;
            session = await page.evaluate(
                () => {
                    return {
                        AccessToken: sessionInfo.AccessToken,
                        ApiGatewayUri: sessionInfo.ApiGatewayUri,
                        ApiGatewayVersion: sessionInfo.ApiGatewayVersion
                    };
                }
            );
        }
        catch (error) {
            if (tries > 5) {
                process.exit(ERROR_CODE.NO_SESSION_INFO);
            }

            session = null;
            tries++;
            await page.waitFor(3000);
        }
    }
    browser.close();

    return session;
}

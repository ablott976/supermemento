#!/usr/bin/env python3
"""Minimal TCP bridge for exposing an SSH reverse tunnel on one private address."""

from __future__ import annotations

import argparse
import asyncio
import logging

LOGGER = logging.getLogger("supermemento.private_bridge")


async def _pump(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    finally:
        try:
            writer.write_eof()
        except (AttributeError, OSError, RuntimeError):
            pass


async def handle_connection(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    target_host: str | None,
    target_port: int | None,
    target_unix: str | None,
) -> None:
    try:
        if target_unix:
            target_reader, target_writer = await asyncio.open_unix_connection(target_unix)
        elif target_host and target_port:
            target_reader, target_writer = await asyncio.open_connection(target_host, target_port)
        else:
            raise ValueError("a TCP or Unix target is required")
    except (OSError, asyncio.TimeoutError):
        client_writer.close()
        await client_writer.wait_closed()
        return

    tasks = {
        asyncio.create_task(_pump(client_reader, target_writer)),
        asyncio.create_task(_pump(target_reader, client_writer)),
    }
    try:
        await asyncio.gather(*tasks)
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        target_writer.close()
        client_writer.close()
        await asyncio.gather(
            target_writer.wait_closed(),
            client_writer.wait_closed(),
            return_exceptions=True,
        )


async def create_server(
    listen_host: str,
    listen_port: int,
    target_host: str | None = None,
    target_port: int | None = None,
    target_unix: str | None = None,
) -> asyncio.Server:
    return await asyncio.start_server(
        lambda reader, writer: handle_connection(
            reader,
            writer,
            target_host,
            target_port,
            target_unix,
        ),
        host=listen_host,
        port=listen_port,
        limit=2_000_000,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen-host", required=True)
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-host", default="127.0.0.1")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--target-port", type=int)
    target.add_argument("--target-unix")
    return parser.parse_args()


async def run() -> None:
    args = parse_args()
    server = await create_server(
        args.listen_host,
        args.listen_port,
        args.target_host,
        args.target_port,
        args.target_unix,
    )
    LOGGER.info("Private TCP bridge ready")
    async with server:
        await server.serve_forever()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())


if __name__ == "__main__":
    main()

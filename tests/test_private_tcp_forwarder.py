from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory

MODULE_PATH = Path(__file__).resolve().parents[1] / "deploy" / "private_tcp_forwarder.py"
spec = importlib.util.spec_from_file_location("private_tcp_forwarder", MODULE_PATH)
assert spec and spec.loader
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def test_private_tcp_forwarder_streams_bidirectionally() -> None:
    async def scenario() -> None:
        async def echo(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            payload = await reader.read(1024)
            writer.write(payload.upper())
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        target = await asyncio.start_server(echo, "127.0.0.1", 0)
        target_port = target.sockets[0].getsockname()[1]
        forwarder = await bridge.create_server("127.0.0.1", 0, "127.0.0.1", target_port)
        listen_port = forwarder.sockets[0].getsockname()[1]
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", listen_port)
            writer.write(b"relay")
            await writer.drain()
            writer.write_eof()
            assert await reader.read() == b"RELAY"
            writer.close()
            await writer.wait_closed()
        finally:
            forwarder.close()
            target.close()
            await forwarder.wait_closed()
            await target.wait_closed()

    asyncio.run(scenario())


def test_private_tcp_forwarder_supports_unix_socket_targets() -> None:
    async def scenario(socket_path: str) -> None:
        async def echo(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            writer.write(await reader.read(1024))
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        target = await asyncio.start_unix_server(echo, socket_path)
        forwarder = await bridge.create_server(
            "127.0.0.1",
            0,
            target_unix=socket_path,
        )
        listen_port = forwarder.sockets[0].getsockname()[1]
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", listen_port)
            writer.write(b"unix-relay")
            await writer.drain()
            writer.write_eof()
            assert await reader.read() == b"unix-relay"
            writer.close()
            await writer.wait_closed()
        finally:
            forwarder.close()
            target.close()
            await forwarder.wait_closed()
            await target.wait_closed()

    with TemporaryDirectory() as directory:
        asyncio.run(scenario(str(Path(directory) / "relay.sock")))
